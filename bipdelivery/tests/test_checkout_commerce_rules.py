"""Online-sales foundation -- Fase B: the checkout enforces the store's
commercial configuration, server-side, before any side effect.

Every rejection here must happen before a SaleOrder / SaleOrderItem /
StockMovement is created, before stock is decremented, and without consuming
an idempotency key.
"""
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import (
    Category,
    DeliveryRegion,
    Product,
    SaleOrder,
    StockMovement,
    Store,
    StoreCommerceSettings,
)

CHECKOUT_URL = "/api/v1/checkout/whatsapp/"


@override_settings(WHATSAPP_ORDER_PHONE="5571999999999")
class CheckoutCommerceRulesTest(TestCase):
    def setUp(self) -> None:
        cache.clear()
        self.store = Store.get_default()
        self.store.whatsapp_phone = "5571988887777"
        self.store.save(update_fields=["whatsapp_phone"])
        self.category = Category.objects.create(
            name="Roupas", slug="roupas", store=self.store
        )
        self.product = Product.objects.create(
            name="Camiseta",
            sku="CAM-1",
            price=Decimal("50.00"),
            stock_quantity=10,
            category=self.category,
            store=self.store,
        )
        self.region = DeliveryRegion.objects.create(
            name="Centro",
            delivery_fee=Decimal("8.00"),
            store=self.store,
            is_active=True,
        )
        self.commerce = StoreCommerceSettings.get_for_store(self.store)

    def _payload(self, **customer) -> dict:
        base = {
            "delivery_method": "pickup",
            "payment_method": "pix",
            "full_name": "Cliente Teste",
            "phone": "71999990000",
        }
        base.update(customer)
        return {
            "items": [{"product_id": self.product.id, "quantity": 1}],
            "customer": base,
        }

    def _post(self, payload: dict):
        return APIClient().post(CHECKOUT_URL, payload, format="json")

    def _assert_no_side_effects(self) -> None:
        self.assertFalse(SaleOrder.objects.exists())
        self.assertFalse(StockMovement.objects.exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 10)

    # --- happy path still works ---

    def test_default_config_allows_checkout(self) -> None:
        response = self._post(self._payload())
        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(
            SaleOrder.objects.get().payment_status,
            SaleOrder.PAYMENT_STATUS_PENDING,
        )

    # --- rejections ---

    def test_store_not_accepting_orders(self) -> None:
        self.commerce.orders_enabled = False
        self.commerce.save()

        response = self._post(self._payload())

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "store_not_accepting_orders")
        self._assert_no_side_effects()

    def test_inactive_store_not_accepting_orders(self) -> None:
        self.store.is_active = False
        self.store.save(update_fields=["is_active"])

        response = self._post(self._payload())

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "store_not_accepting_orders")
        self._assert_no_side_effects()

    def test_delivery_method_unavailable(self) -> None:
        self.commerce.delivery_enabled = False
        self.commerce.save()

        response = self._post(
            self._payload(
                delivery_method="delivery",
                address="Rua A, 1",
                neighborhood="Centro",
                city="Salvador",
                delivery_region_id=self.region.id,
            )
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "delivery_method_unavailable")
        self._assert_no_side_effects()

    def test_pickup_method_unavailable(self) -> None:
        self.commerce.pickup_enabled = False
        self.commerce.save()

        response = self._post(self._payload(delivery_method="pickup"))

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "delivery_method_unavailable")
        self._assert_no_side_effects()

    def test_payment_method_unavailable(self) -> None:
        self.commerce.accepts_cash = False
        self.commerce.save()

        response = self._post(self._payload(payment_method="cash"))

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "payment_method_unavailable")
        self._assert_no_side_effects()

    def test_minimum_order_not_reached(self) -> None:
        self.commerce.minimum_order_value = Decimal("120.00")
        self.commerce.save()

        # subtotal recalculated server-side is 50.00 (1 x product) -> below 120.
        response = self._post(self._payload())

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "minimum_order_not_reached")
        self._assert_no_side_effects()

    def test_order_exactly_at_minimum_is_accepted(self) -> None:
        self.commerce.minimum_order_value = Decimal("100.00")
        self.commerce.save()

        response = APIClient().post(
            CHECKOUT_URL,
            {
                "items": [{"product_id": self.product.id, "quantity": 2}],
                "customer": {
                    "delivery_method": "pickup",
                    "payment_method": "pix",
                    "full_name": "Cliente Teste",
                    "phone": "71999990000",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)

    def test_minimum_compares_recalculated_subtotal_not_client_value(self) -> None:
        # Client can't sneak past the minimum by lying about price: the
        # payload only carries product_id + quantity, and the backend prices
        # every line itself.
        self.commerce.minimum_order_value = Decimal("60.00")
        self.commerce.save()

        response = self._post(self._payload())  # 1 x 50.00 -> 50 < 60

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "minimum_order_not_reached")

    def test_delivery_region_from_another_store_is_rejected(self) -> None:
        other_store = Store.objects.create(name="Loja B", slug="loja-b-cc")
        foreign_region = DeliveryRegion.objects.create(
            name="Centro B",
            delivery_fee=Decimal("99.00"),
            store=other_store,
        )

        response = self._post(
            self._payload(
                delivery_method="delivery",
                address="Rua A, 1",
                neighborhood="Centro",
                city="Salvador",
                delivery_region_id=foreign_region.id,
            )
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self.assertEqual(response.data["code"], "delivery_region_unavailable")
        self._assert_no_side_effects()

    def test_pickup_never_requires_address_or_region(self) -> None:
        self.commerce.minimum_order_value = Decimal("0.00")
        self.commerce.save()

        response = self._post(self._payload(delivery_method="pickup"))

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        order = SaleOrder.objects.get()
        self.assertEqual(order.address, "")
        self.assertIsNone(order.delivery_region_id)

    # --- rejection does not consume an idempotency key ---

    def test_rejection_does_not_consume_idempotency_key(self) -> None:
        self.commerce.orders_enabled = False
        self.commerce.save()

        rejected = APIClient().post(
            CHECKOUT_URL,
            {**self._payload(), "idempotency_key": "reuse-key-1"},
            format="json",
        )
        self.assertEqual(
            rejected.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )

        # Store re-opens; the very same key now creates a real order.
        self.commerce.orders_enabled = True
        self.commerce.save()

        accepted = APIClient().post(
            CHECKOUT_URL,
            {**self._payload(), "idempotency_key": "reuse-key-1"},
            format="json",
        )
        self.assertEqual(accepted.status_code, status.HTTP_200_OK, msg=accepted.data)
        self.assertEqual(SaleOrder.objects.count(), 1)

    def test_idempotent_replay_returns_existing_order_even_if_store_closes(
        self,
    ) -> None:
        first = APIClient().post(
            CHECKOUT_URL,
            {**self._payload(), "idempotency_key": "replay-key-1"},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK, msg=first.data)
        reference = first.data["order_reference"]

        # Store closes, then the client retries the same request (network blip).
        self.commerce.orders_enabled = False
        self.commerce.save()

        replay = APIClient().post(
            CHECKOUT_URL,
            {**self._payload(), "idempotency_key": "replay-key-1"},
            format="json",
        )
        self.assertEqual(replay.status_code, status.HTTP_200_OK, msg=replay.data)
        self.assertEqual(replay.data["order_reference"], reference)
        self.assertEqual(SaleOrder.objects.count(), 1)

    def test_minimum_rejection_happens_before_any_stock_decrement(self) -> None:
        self.commerce.minimum_order_value = Decimal("500.00")
        self.commerce.save()

        response = APIClient().post(
            CHECKOUT_URL,
            {
                "items": [{"product_id": self.product.id, "quantity": 3}],
                "customer": {
                    "delivery_method": "pickup",
                    "payment_method": "pix",
                    "full_name": "Cliente",
                    "phone": "71999990000",
                },
            },
            format="json",
        )

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        self._assert_no_side_effects()
