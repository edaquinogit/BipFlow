"""Adversarial: direct tamper attempts against POST /v1/pdv/sales/.

No client-supplied field may grant financial authority. Price, total, store,
operator, payment status, channel and paid_at are set server-side only; a
foreign product/variant, an out-of-range quantity or a poisoned idempotency
key must be refused with no side effect.

Reuses TwoStoreFixtureMixin (test_store_active_isolation.py).
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import (
    Product,
    ProductVariant,
    SaleOrder,
    StockMovement,
    StoreMembership,
)
from bipdelivery.tests.test_store_active_isolation import TwoStoreFixtureMixin

URL = "/api/v1/pdv/sales/"


class PdvSaleTamperTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.product_b.price = Decimal("20.00")
        self.product_b.stock_quantity = 10
        self.product_b.save(update_fields=["price", "stock_quantity", "is_available"])
        # A product + active variant owned by the OTHER store (store_a).
        self.foreign_product = Product.objects.create(
            name="Alheio", price=Decimal("5.00"), category=self.category_a,
            store=self.store_a, stock_quantity=9,
        )
        self.foreign_variant = ProductVariant.objects.create(
            product=self.foreign_product, name="Verde", color_hex="#00FF00",
            stock_quantity=9, position=0,
        )
        self.second_local = Product.objects.create(
            name="Segundo Local", price=Decimal("15.00"), category=self.category_b,
            store=self.store_b, stock_quantity=4,
        )

    def _post(self, body, client=None):
        return (client or self.client).post(URL, body, format="json")

    def _base(self, **extra):
        body = {
            "items": [{"public_code": self.product_b.public_code, "quantity": 2}],
            "payment_method": "pix",
        }
        body.update(extra)
        return body

    def _only_sale(self) -> SaleOrder:
        sales = SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA)
        self.assertEqual(sales.count(), 1)
        return sales.get()

    # --- price / total are server-authoritative ---------------------------

    def test_item_price_fields_in_the_payload_are_ignored(self) -> None:
        body = self._base()
        body["items"][0].update(
            {"unit_price": "0.01", "price": "0.01", "line_total": "0.02"}
        )
        response = self._post(body)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["subtotal"], "40.00")  # 2 x 20.00, server price
        self.assertEqual(response.data["total"], "40.00")
        sale = self._only_sale()
        self.assertEqual(sale.total, Decimal("40.00"))
        self.assertEqual(sale.items.get().unit_price, Decimal("20.00"))

    def test_top_level_total_and_subtotal_are_ignored(self) -> None:
        response = self._post(self._base(total="1.00", subtotal="1.00"))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._only_sale().total, Decimal("40.00"))

    # --- store / operator / status / channel are server-set ---------------

    def test_store_in_the_payload_cannot_move_the_sale_to_another_tenant(self) -> None:
        response = self._post(
            self._base(store=self.store_a.id, store_id=self.store_a.id)
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._only_sale().store_id, self.store_b.id)

    def test_performed_by_in_the_payload_is_ignored(self) -> None:
        other = User.objects.create_user(username="ghost", password="x")
        response = self._post(
            self._base(performed_by=other.id, performed_by_id=other.id)
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._only_sale().performed_by_id, self.user_b.id)

    def test_payment_status_and_paid_flags_in_the_payload_are_ignored(self) -> None:
        response = self._post(
            self._base(payment_status="refunded", paid_at="2000-01-01T00:00:00Z")
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        sale = self._only_sale()
        self.assertEqual(sale.payment_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertGreater(sale.paid_at.year, 2020)
        self.assertEqual(sale.payment_status_events.count(), 1)

    def test_channel_in_the_payload_is_ignored(self) -> None:
        response = self._post(self._base(channel=SaleOrder.CHANNEL_VIRTUAL))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            self._only_sale().channel, SaleOrder.CHANNEL_LOJA_FISICA
        )

    def test_order_reference_in_the_payload_is_ignored(self) -> None:
        response = self._post(self._base(order_reference="BPF-HIJACK-1"))

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["order_reference"].startswith("PDV-"))

    # --- foreign / malformed product & variant ---------------------------

    def test_foreign_store_public_code_is_rejected_without_side_effects(self) -> None:
        response = self._post(
            self._base(items=[{"public_code": self.foreign_product.public_code, "quantity": 1}])
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )
        self.foreign_product.refresh_from_db()
        self.assertEqual(self.foreign_product.stock_quantity, 9)

    def test_foreign_variant_id_on_a_local_product_is_rejected(self) -> None:
        response = self._post(
            self._base(items=[{
                "public_code": self.product_b.public_code,
                "variant_id": self.foreign_variant.id,
                "quantity": 1,
            }])
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StockMovement.objects.exists())

    def test_quantity_must_be_positive(self) -> None:
        for bad in (0, -3):
            with self.subTest(qty=bad):
                response = self._post(
                    self._base(items=[{"public_code": self.product_b.public_code, "quantity": bad}])
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_quantity_over_stock_is_rejected_atomically(self) -> None:
        response = self._post(
            self._base(items=[
                {"public_code": self.product_b.public_code, "quantity": 2},
                {"public_code": self.second_local.public_code, "quantity": 999},
            ])
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)

    def test_unknown_payment_method_is_rejected(self) -> None:
        response = self._post(self._base(payment_method="crypto"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_oversized_notes_are_rejected(self) -> None:
        response = self._post(self._base(notes="x" * 2000))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- idempotency key cannot be weaponised ---------------------------

    def test_a_stores_key_cannot_be_used_to_read_another_stores_sale(self) -> None:
        first = self._post(self._base(idempotency_key="shared-key-0001"))
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        ref_b = first.data["order_reference"]

        # store_a operator replays the SAME key.
        staff_a = User.objects.create_user(
            username="staff_a_key", password="x", is_staff=True
        )
        StoreMembership.objects.create(
            store=self.store_a, user=staff_a, role=StoreMembership.ROLE_MANAGER
        )
        self.foreign_product.stock_quantity = 5
        self.foreign_product.save(update_fields=["stock_quantity", "is_available"])
        client_a = APIClient()
        client_a.force_authenticate(user=staff_a, token={"store_id": self.store_a.id})

        response = self._post(
            {
                "items": [{"public_code": self.foreign_product.public_code, "variant_id": self.foreign_variant.id, "quantity": 1}],
                "payment_method": "cash",
                "idempotency_key": "shared-key-0001",
            },
            client=client_a,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(response.data["order_reference"], ref_b)
        self.assertEqual(
            SaleOrder.objects.filter(store=self.store_a, channel=SaleOrder.CHANNEL_LOJA_FISICA).count(),
            1,
        )

    def test_malformed_idempotency_key_is_rejected(self) -> None:
        response = self._post(self._base(idempotency_key="bad key!"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- RBAC / auth (reaffirm on the tamper surface) --------------------

    def test_viewer_cannot_ring_up_even_with_a_perfect_payload(self) -> None:
        viewer = User.objects.create_user(username="v_tamper", password="x")
        StoreMembership.objects.create(
            store=self.store_b, user=viewer, role=StoreMembership.ROLE_VIEWER
        )
        client = APIClient()
        client.force_authenticate(user=viewer, token={"store_id": self.store_b.id})

        response = self._post(self._base(), client=client)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(
            SaleOrder.objects.filter(channel=SaleOrder.CHANNEL_LOJA_FISICA).exists()
        )

    def test_anonymous_is_401(self) -> None:
        response = self._post(self._base(), client=APIClient())
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_effective_price_is_the_only_price_source(self) -> None:
        """Even if a caller could reach the serializer with a price, the
        reservation never consults the payload for money."""
        with patch.object(
            Product, "get_effective_price", return_value=Decimal("7.77")
        ) as priced:
            response = self._post(self._base())
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(priced.called)
        self.assertEqual(self._only_sale().total, Decimal("15.54"))
