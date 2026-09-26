"""PDV sale finalization: idempotency and the store's commercial rules
(PDV / QR / presential-payment evolution, see
docs/architecture/pdv-qr-payment-evolution.md).

`POST /v1/pdv/sales/` gained an optional `idempotency_key` so a
double-tapped "Finalizar venda", a retried request after a network blip or
a held-down Enter can never ring the same cart up twice; and it now honours
`StoreCommerceSettings` -- a payment method the store switched off is
rejected with the same HTTP 422 + {code, detail} shape the online checkout
uses.

Reuses TwoStoreFixtureMixin (test_store_active_isolation.py) like
test_pdv_sales.py.
"""

import threading
import unittest
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api import pdv as pdv_module
from bipdelivery.api.models import (
    PaymentStatusEvent,
    SaleOrder,
    SaleOrderItem,
    StockMovement,
    StoreCommerceSettings,
    StoreMembership,
)
from bipdelivery.tests.test_store_active_isolation import TwoStoreFixtureMixin

PDV_SALES_URL = "/api/v1/pdv/sales/"
KEY = "pdv-idem-key-0001"


class PdvSaleIdempotencyTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.product_b.stock_quantity = 10
        self.product_b.save(update_fields=["stock_quantity", "is_available"])

    def _post(self, **overrides):
        body = {
            "items": [{"public_code": self.product_b.public_code, "quantity": 3}],
            "payment_method": "cash",
        }
        body.update(overrides)
        return self.client.post(PDV_SALES_URL, body, format="json")

    def test_replay_with_the_same_key_returns_the_original_sale(self) -> None:
        first = self._post(idempotency_key=KEY)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self._post(idempotency_key=KEY)

        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            second.data["order_reference"], first.data["order_reference"]
        )
        self.assertEqual(second.data["subtotal"], first.data["subtotal"])
        self.assertEqual(len(second.data["items"]), len(first.data["items"]))

        # Exactly one of everything: no second decrement, event or movement.
        self.assertEqual(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).count(), 1
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 7)
        sale = SaleOrder.objects.get(order_reference=first.data["order_reference"])
        self.assertEqual(sale.payment_status_events.count(), 1)
        self.assertEqual(
            StockMovement.objects.filter(sale_order=sale).count(), 1
        )

    def test_same_key_with_a_different_cart_is_a_conflict(self) -> None:
        first = self._post(idempotency_key=KEY)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        conflict = self._post(
            idempotency_key=KEY,
            items=[{"public_code": self.product_b.public_code, "quantity": 1}],
        )

        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(conflict.data["code"], "idempotency_key_conflict")
        self.assertEqual(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).count(), 1
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 7)

    def test_without_a_key_two_identical_requests_create_two_sales(self) -> None:
        self.assertEqual(self._post().status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._post().status_code, status.HTTP_201_CREATED)

        self.assertEqual(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).count(), 2
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 4)

    def test_a_malformed_idempotency_key_is_rejected(self) -> None:
        response = self._post(idempotency_key="short")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )

    def test_concurrent_insert_race_recovers_by_returning_the_winner(self) -> None:
        """The pre-flight lookup runs before the winner's row is visible, so
        the request proceeds into the transaction and trips the per-store
        unique constraint. It must recover with the winner's sale -- one
        SaleOrder, stock decremented once -- not a 500 or a double decrement.
        """
        first = self._post(idempotency_key=KEY)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        real_lookup = pdv_module.find_pdv_idempotent_order
        calls = {"count": 0}

        def blind_first(**kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                return None  # winner's committed row not visible yet
            return real_lookup(**kwargs)

        with patch.object(pdv_module, "find_pdv_idempotent_order", blind_first):
            second = self._post(idempotency_key=KEY)

        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            second.data["order_reference"], first.data["order_reference"]
        )
        self.assertEqual(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).count(), 1
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 7)

    def test_the_key_is_scoped_per_store(self) -> None:
        """The same key used by a different tenant is a different sale -- one
        store's key must never short-circuit another's."""
        first = self._post(idempotency_key=KEY)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        self.product_a.stock_quantity = 5
        self.product_a.save(update_fields=["stock_quantity", "is_available"])
        staff_a = User.objects.create_user(
            username="pdv_staff_a", password="testpass123", is_staff=True
        )
        StoreMembership.objects.create(
            store=self.store_a, user=staff_a, role=StoreMembership.ROLE_MANAGER
        )
        client_a = APIClient()
        client_a.force_authenticate(
            user=staff_a, token={"store_id": self.store_a.id}
        )

        response = client_a.post(
            PDV_SALES_URL,
            {
                "items": [{"public_code": self.product_a.public_code, "quantity": 1}],
                "payment_method": "cash",
                "idempotency_key": KEY,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(
            response.data["order_reference"], first.data["order_reference"]
        )


class PdvSalePaymentMethodTest(TwoStoreFixtureMixin, TestCase):
    """`StoreCommerceSettings.accepts_pix/card/cash` are the *online
    storefront's* payment config (their model docstring, the "Vendas online"
    tab, the go-live check and the public projection all scope them to the
    vitrine). The counter has always taken pix/card/cash unconditionally and
    must keep doing so -- a merchant disabling a method for online checkout
    must not have their physical machine refused. These tests lock that in.
    """

    def setUp(self) -> None:
        super().setUp()
        self.product_b.stock_quantity = 30
        self.product_b.save(update_fields=["stock_quantity", "is_available"])
        self.commerce = StoreCommerceSettings.get_for_store(self.store_b)

    def _post(self, payment_method: str, **overrides):
        body = {
            "items": [{"public_code": self.product_b.public_code, "quantity": 1}],
            "payment_method": payment_method,
        }
        body.update(overrides)
        return self.client.post(PDV_SALES_URL, body, format="json")

    def test_pdv_ignores_a_payment_method_disabled_for_the_online_storefront(
        self,
    ) -> None:
        self.commerce.accepts_pix = False
        self.commerce.accepts_card = False
        self.commerce.save(update_fields=["accepts_pix", "accepts_card"])

        for method in ("pix", "card", "cash"):
            with self.subTest(method=method):
                response = self._post(method)
                self.assertEqual(
                    response.status_code, status.HTTP_201_CREATED, msg=response.data
                )
                sale = SaleOrder.objects.get(
                    order_reference=response.data["order_reference"]
                )
                self.assertEqual(sale.payment_method, method)

    def test_an_unknown_payment_method_is_still_rejected(self) -> None:
        response = self._post("boleto")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_default_settings_accept_all_three_methods(self) -> None:
        for method in ("pix", "card", "cash"):
            with self.subTest(method=method):
                self.assertEqual(
                    self._post(method).status_code, status.HTTP_201_CREATED
                )


class PdvSaleCrossChannelIdempotencyTest(TwoStoreFixtureMixin, TestCase):
    """The per-store `idempotency_key` unique constraint on SaleOrder is
    shared with the online checkout (not channel-scoped). A PDV request whose
    key is already held by a virtual/WhatsApp order in the same store must
    get a clean 409 -- never that other channel's order back, and never a
    500 -- and must not create a duplicate.
    """

    def setUp(self) -> None:
        super().setUp()
        self.product_b.stock_quantity = 10
        self.product_b.save(update_fields=["stock_quantity", "is_available"])
        self.virtual_order = SaleOrder.objects.create(
            store=self.store_b,
            order_reference="BPF-VIRT-XCH",
            channel=SaleOrder.CHANNEL_VIRTUAL,
            idempotency_key=KEY,
            idempotency_payload_hash="deadbeef",
            customer_name="Cliente Virtual",
            customer_phone="",
            delivery_method="pickup",
            payment_method="pix",
            subtotal="10.00",
            delivery_fee="0.00",
            total="10.00",
        )

    def _post(self, **overrides):
        body = {
            "items": [{"public_code": self.product_b.public_code, "quantity": 2}],
            "payment_method": "cash",
            "idempotency_key": KEY,
        }
        body.update(overrides)
        return self.client.post(PDV_SALES_URL, body, format="json")

    def test_pdv_key_colliding_with_a_virtual_order_returns_409_not_that_order(
        self,
    ) -> None:
        response = self._post()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "idempotency_key_conflict")
        # No PDV sale created, no stock moved.
        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)

    def test_collision_surfacing_only_inside_the_transaction_still_409s(self) -> None:
        """If the pre-flight lookup misses the virtual order (race), the
        INSERT trips the shared unique constraint -- the IntegrityError
        handler must still resolve to a 409, not a 500."""
        with patch.object(pdv_module, "find_pdv_idempotent_order") as lookup:
            lookup.side_effect = [None, self.virtual_order]
            response = self._post()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)


class PdvSaleAtomicityTest(TwoStoreFixtureMixin, TestCase):
    """A mid-transaction failure must leave nothing behind -- no order, no
    item, no payment event, no stock movement, no decrement (gate: "nenhum
    erro pode deixar venda parcialmente gravada")."""

    def setUp(self) -> None:
        super().setUp()
        self.product_b.stock_quantity = 10
        self.product_b.save(update_fields=["stock_quantity", "is_available"])

    def test_failure_after_the_order_row_exists_rolls_everything_back(self) -> None:
        boom = RuntimeError("injected failure after SaleOrder.create")
        events_before = PaymentStatusEvent.objects.count()

        with patch.object(
            pdv_module.StockMovement.objects, "bulk_create", side_effect=boom
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    PDV_SALES_URL,
                    {
                        "items": [
                            {"public_code": self.product_b.public_code, "quantity": 4}
                        ],
                        "payment_method": "cash",
                    },
                    format="json",
                )

        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )
        # The two mixin fixture orders carry no items, so any row here would
        # be a leaked partial write.
        self.assertFalse(SaleOrderItem.objects.exists())
        self.assertEqual(PaymentStatusEvent.objects.count(), events_before)
        self.assertFalse(StockMovement.objects.exists())
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)


@unittest.skipUnless(
    connection.vendor == "postgresql",
    "Real multi-writer concurrency needs Postgres. SQLite serialises every "
    "writer behind one global lock and rejects the losers with "
    "OperationalError before the transaction body runs, so it cannot "
    "exercise the parallel path. Run with a Postgres DATABASE_URL:\n"
    "  DATABASE_URL=postgres://user:pass@localhost:5432/db python -m pytest \\\n"
    "    bipdelivery/tests/test_pdv_idempotency.py::PdvSaleConcurrencyTest\n"
    "The deterministic recovery path (IntegrityError -> return the winner) is "
    "always covered by test_concurrent_insert_race_recovers_by_returning_the_winner.",
)
class PdvSaleConcurrencyTest(TransactionTestCase):
    """Genuinely concurrent requests carrying the same idempotency key, fired
    from real threads against a live Postgres database. Whatever the
    interleaving, the invariant holds: exactly one sale, one stock
    decrement, one payment event, one set of stock movements.
    """

    reset_sequences = True

    def setUp(self) -> None:
        from decimal import Decimal

        from bipdelivery.api.models import Category, Product, Store

        self.store = Store.objects.create(name="Loja Conc", slug="loja-conc")
        category = Category.objects.create(name="Cat", store=self.store)
        self.product = Product.objects.create(
            name="Produto Conc",
            price=Decimal("20.00"),
            category=category,
            store=self.store,
            stock_quantity=50,
        )
        self.product.stock_quantity = 50
        self.product.save(update_fields=["stock_quantity", "is_available"])
        self.user = User.objects.create_user(
            username="conc_staff", password="testpass123", is_staff=True
        )
        StoreMembership.objects.create(
            store=self.store, user=self.user, role=StoreMembership.ROLE_MANAGER
        )

    def _fire(self, results: list, index: int, barrier: threading.Barrier) -> None:
        client = APIClient()
        client.force_authenticate(
            user=self.user, token={"store_id": self.store.id}
        )
        try:
            barrier.wait(timeout=5)
            response = client.post(
                PDV_SALES_URL,
                {
                    "items": [
                        {"public_code": self.product.public_code, "quantity": 2}
                    ],
                    "payment_method": "cash",
                    "idempotency_key": KEY,
                },
                format="json",
            )
            results[index] = response.status_code
        except Exception as exc:  # a write-lock loser is still a valid outcome
            results[index] = f"error:{type(exc).__name__}"
        finally:
            connections.close_all()

    def test_parallel_double_submit_creates_exactly_one_sale(self) -> None:
        thread_count = 3
        results: list = [None] * thread_count
        barrier = threading.Barrier(thread_count)
        threads = [
            threading.Thread(target=self._fire, args=(results, i, barrier))
            for i in range(thread_count)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)

        connection.close()

        # At least one writer succeeded; every code seen is an expected one
        # (created, idempotent replay -> 201, or a DB write-lock loser under
        # SQLite -- never a duplicate sale).
        self.assertIn(
            status.HTTP_201_CREATED, results, msg=f"results={results}"
        )
        for code in results:
            self.assertTrue(
                code == status.HTTP_201_CREATED
                or code == status.HTTP_409_CONFLICT
                or (isinstance(code, str) and code.startswith("error:")),
                msg=f"unexpected outcome {code!r} in {results}",
            )

        # The invariant that actually matters: no double sale, no double
        # decrement, no duplicate financial event -- whatever the interleaving.
        sales = SaleOrder.objects.filter(store=self.store)
        self.assertEqual(sales.count(), 1, msg=f"results={results}")
        sale = sales.get()
        self.assertEqual(sale.idempotency_key, KEY)
        self.assertEqual(sale.payment_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertEqual(SaleOrderItem.objects.filter(order=sale).count(), 1)
        self.assertEqual(sale.payment_status_events.count(), 1)
        self.assertEqual(StockMovement.objects.filter(sale_order=sale).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 48)
