from django.test import TestCase
from rest_framework.test import APIClient
from bipdelivery.api.models import Store, Category, Product, StoreShippingSettings


class ShippingQuoteApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.store = Store.objects.create(name="Quote A", slug="api-quote-a")
        self.other = Store.objects.create(name="Quote B", slug="api-quote-b")
        self.url = "/api/v1/public/stores/api-quote-a/shipping-quotes/"
        self.settings = StoreShippingSettings.get_for_store(self.store)
        self.settings.origin_postal_code = "40010000"
        self.settings.package_options = [
            dict(name="box", length_cm=20, width_cm=15, height_cm=10)
        ]
        self.settings.save()
        self.product = self.make_product(self.store)
        self.foreign = self.make_product(self.other)
        self.payload = {"destination_postal_code": "49010000",
                        "items": [{"product_id": self.product.pk, "quantity": 1}]}

    def make_product(self, store):
        category = Category.objects.create(store=store, name="General")
        return Product.objects.create(store=store, category=category, name="Item",
                                      price=10, stock_quantity=5, weight_grams=200,
                                      length_cm=10, width_cm=8, height_cm=3)

    def enable(self):
        self.settings.national_shipping_enabled = True
        self.settings.save()

    def test_disabled_by_default(self):
        self.assertEqual(self.client.get(self.url).json(), {"enabled": False})
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 404)

    def test_enabled_preview_is_not_order_confirmation(self):
        self.enable()
        self.assertEqual(self.client.get(self.url).json(), {"enabled": True})
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["simulated"])
        self.assertFalse(response.data["order_confirmation_available"])
        self.assertEqual(len(response.data["quotes"]), 2)
        self.assertEqual(response.data["quotes"][0]["provider"], "simulated")

    def test_foreign_product_rejected_even_with_header(self):
        self.enable()
        self.payload["items"][0]["product_id"] = self.foreign.pk
        response = self.client.post(self.url, self.payload, format="json",
                                    HTTP_X_STORE_SLUG=self.other.slug)
        self.assertEqual(response.status_code, 400)

    def test_client_price_rejected(self):
        self.enable()
        self.payload["price"] = "0.01"
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 400)

    def test_other_store_remains_disabled(self):
        self.enable()
        url = self.url.replace(self.store.slug, self.other.slug)
        self.assertEqual(self.client.get(url).json(), {"enabled": False})
        self.assertEqual(self.client.post(url, self.payload, format="json").status_code, 404)
