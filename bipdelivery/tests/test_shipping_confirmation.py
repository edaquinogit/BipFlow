from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bipdelivery.api.models import Category, Product, SaleOrder, Store, StoreShippingSettings


class NationalShippingCheckoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.store = Store.objects.create(name="National", slug="national-test",
                                          whatsapp_phone="5571999999999")
        category = Category.objects.create(store=self.store, name="General")
        self.product = Product.objects.create(
            store=self.store, category=category, name="Item", price=10,
            stock_quantity=5, weight_grams=200, length_cm=10, width_cm=8, height_cm=3,
        )
        self.config = StoreShippingSettings.get_for_store(self.store)
        self.config.origin_postal_code = "40010000"
        self.config.national_shipping_enabled = True
        self.config.package_options = [
            dict(name="box", length_cm=20, width_cm=15, height_cm=10)
        ]
        self.config.save()
        self.client = APIClient()
        self.payload = {
            "items": [{"product_id": self.product.pk, "quantity": 1}],
            "customer": {"delivery_method": "delivery", "payment_method": "pix",
                         "full_name": "Cliente Teste", "phone": "71999999999",
                         "address": "Rua Teste 10", "neighborhood": "Centro",
                         "city": "Aracaju"},
            "national_shipping": {"destination_postal_code": "49010000",
                                  "service": "economico_simulado", "state": "SE",
                                  "expected_price": "16.00"},
        }

    def checkout(self):
        return self.client.post("/api/v1/checkout/whatsapp/", self.payload,
                                format="json", HTTP_X_STORE_SLUG=self.store.slug)

    def assert_no_sale(self):
        self.assertFalse(SaleOrder.objects.filter(store=self.store).exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 5)

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=False)
    def test_global_gate_defaults_to_safe_rejection(self):
        self.assertEqual(self.checkout().status_code, 422)
        self.assert_no_sale()

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_snapshot_and_total(self):
        response = self.checkout()
        self.assertEqual(response.status_code, 200, response.data)
        order = SaleOrder.objects.get(store=self.store)
        self.assertEqual(str(order.delivery_fee), "16.00")
        self.assertEqual(str(order.total), "26.00")
        self.assertEqual(order.shipping_snapshot["kind"], "national_simulated")
        self.assertEqual(order.shipping_snapshot["destination_postal_code"], "49010000")
        self.assertIsNone(order.delivery_region_id)
        self.config.origin_postal_code = "10010000"
        self.config.save()
        order.refresh_from_db()
        self.assertEqual(order.shipping_snapshot["origin_postal_code"], "40010000")

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_price_change_rolls_back_stock(self):
        self.payload["national_shipping"]["expected_price"] = "0.01"
        self.assertEqual(self.checkout().status_code, 422)
        self.assert_no_sale()

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_tenant_gate_rolls_back_stock(self):
        self.config.national_shipping_enabled = False
        self.config.save()
        self.assertEqual(self.checkout().status_code, 422)
        self.assert_no_sale()

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_invalid_state_rejected(self):
        self.payload["national_shipping"]["state"] = "XX"
        self.assertEqual(self.checkout().status_code, 400)
        self.assert_no_sale()

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_foreign_product_rejected(self):
        other = Store.objects.create(name="Other", slug="national-other")
        category = Category.objects.create(store=other, name="General")
        foreign = Product.objects.create(store=other, category=category, name="Foreign",
                                         price=10, stock_quantity=5)
        self.payload["items"][0]["product_id"] = foreign.pk
        self.assertEqual(self.checkout().status_code, 400)
        self.assert_no_sale()
        foreign.refresh_from_db()
        self.assertEqual(foreign.stock_quantity, 5)

    @override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
    def test_idempotent_retry_does_not_reserve_twice(self):
        self.payload["idempotency_key"] = "national-test-retry"
        self.assertEqual(self.checkout().status_code, 200)
        self.assertEqual(self.checkout().status_code, 200)
        self.assertEqual(SaleOrder.objects.filter(store=self.store).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 4)
