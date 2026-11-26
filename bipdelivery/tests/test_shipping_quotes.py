from decimal import Decimal

from django.test import TestCase

from bipdelivery.api.models import Category, Product, Store, StoreShippingSettings
from bipdelivery.api.shipping_quotes import (
    Rate, ShippingQuoteError, SimulatedProvider, simulate_shipping,
)


class SimulatedShippingTests(TestCase):
    def setUp(self):
        self.store = Store.objects.create(name="Shipping A", slug="quote-a")
        self.other = Store.objects.create(name="Shipping B", slug="quote-b")
        self.settings = StoreShippingSettings.get_for_store(self.store)
        self.settings.origin_postal_code = "40010000"
        self.settings.packaging_weight_grams = 50
        self.settings.package_options = [
            dict(name="large", length_cm=40, width_cm=30, height_cm=20, tare_weight_grams=200),
            dict(name="small", length_cm=20, width_cm=15, height_cm=10, tare_weight_grams=100),
        ]
        self.settings.save()
        self.product = self.make_product(self.store)
        self.foreign = self.make_product(self.other)

    def make_product(self, store):
        category = Category.objects.create(store=store, name="General")
        return Product.objects.create(
            store=store, category=category, name="Item", price="10.00",
            weight_grams=200, length_cm=10, width_cm=8, height_cm=3,
            stock_quantity=10,
        )

    def quote(self, items=None, destination="49010-000", provider=None):
        return simulate_shipping(
            store=self.store, destination=destination, provider=provider,
            items=items if items is not None else [
                {"product_id": self.product.pk, "quantity": 2}
            ],
        )

    def test_weight_volume_and_smallest_box(self):
        parcel, quotes = self.quote()
        self.assertEqual(parcel.name, "small")
        self.assertEqual(parcel.weight_grams, 550)
        self.assertEqual(parcel.volume_cm3, Decimal("3000"))
        self.assertEqual(quotes[0].billable_grams, 550)
        self.assertEqual(quotes[0].price, Decimal("16.00"))
        self.assertEqual(quotes[0].provider, "simulated")
        self.assertIn("Simulacao", quotes[0].notice)
        self.settings.refresh_from_db()
        self.assertFalse(self.settings.national_shipping_enabled)

    def test_duplicate_items_are_aggregated_and_larger_box_selected(self):
        parcel, quotes = self.quote([
            {"product_id": self.product.pk, "quantity": 4},
            {"product_id": self.product.pk, "quantity": 4},
        ])
        self.assertEqual(parcel.name, "large")
        self.assertEqual(parcel.weight_grams, 1850)
        self.assertEqual(quotes[0].billable_grams, 4000)

    def test_cep_zone_and_configurable_rates(self):
        _, near = self.quote()
        _, far = self.quote(destination="90000000")
        self.assertGreater(far[0].price, near[0].price)
        self.assertGreater(far[0].estimated_days, near[0].estimated_days)
        _, custom = self.quote(provider=SimulatedProvider(
            rates=(Rate("test", Decimal("1"), Decimal("2"), Decimal("0"), 1),)
        ))
        self.assertEqual(custom[0].price, Decimal("3.00"))

    def test_foreign_product_is_rejected(self):
        with self.assertRaises(ShippingQuoteError):
            self.quote([{"product_id": self.foreign.pk, "quantity": 1}])

    def test_missing_logistics_rejected_without_changing_catalog(self):
        self.product.weight_grams = None
        self.product.save()
        with self.assertRaises(ShippingQuoteError):
            self.quote()
        self.product.refresh_from_db()
        self.assertIsNone(self.product.weight_grams)

    def test_invalid_postal_codes_and_quantities(self):
        for cep in ("123", "abc49010000", "49010-0000"):
            with self.subTest(cep=cep), self.assertRaises(ShippingQuoteError):
                self.quote(destination=cep)
        for qty in (0, -1, 1.5, True, 101):
            with self.subTest(qty=qty), self.assertRaises(ShippingQuoteError):
                self.quote([{"product_id": self.product.pk, "quantity": qty}])

    def test_no_fitting_box(self):
        self.settings.package_options = self.settings.package_options[1:]
        self.settings.save()
        with self.assertRaises(ShippingQuoteError):
            self.quote([{"product_id": self.product.pk, "quantity": 20}])
