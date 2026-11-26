from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.db import connection, connections, transaction
from django.test import TransactionTestCase

from bipdelivery.api.models import Category, Product, Store


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class ShippingConcurrencyTests(TransactionTestCase):
    def test_last_unit_is_reserved_only_once(self):
        store = Store.objects.create(name="Concurrent", slug="shipping-lock")
        category = Category.objects.create(store=store, name="General")
        product = Product.objects.create(store=store, category=category,
                                         name="Last unit", price=10, stock_quantity=1)
        barrier = Barrier(2)

        def reserve():
            try:
                barrier.wait(timeout=10)
                with transaction.atomic():
                    item = Product.objects.select_for_update().get(pk=product.pk, store=store)
                    if item.stock_quantity < 1:
                        return False
                    item.stock_quantity -= 1
                    item.save(update_fields=["stock_quantity"])
                    return True
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(reserve) for _ in range(2)]
            self.assertEqual(sorted(f.result(timeout=30) for f in futures), [False, True])
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 0)


from copy import deepcopy
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient
from bipdelivery.api.models import SaleOrder, StoreShippingSettings


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
@override_settings(BIPFLOW_SIMULATED_NATIONAL_CHECKOUT=True)
class NationalCheckoutConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.store = Store.objects.create(name="Concurrent", slug="concurrent-national",
                                          whatsapp_phone="5571999999999")
        category = Category.objects.create(store=self.store, name="General")
        self.product = Product.objects.create(
            store=self.store, category=category, name="Last unit", price=10,
            stock_quantity=1, weight_grams=200, length_cm=10, width_cm=8, height_cm=3,
        )
        config = StoreShippingSettings.get_for_store(self.store)
        config.origin_postal_code = "40010000"
        config.national_shipping_enabled = True
        config.package_options = [dict(name="box", length_cm=20, width_cm=15, height_cm=10)]
        config.save()
        self.payload = {
            "items": [{"product_id": self.product.pk, "quantity": 1}],
            "customer": {"delivery_method": "delivery", "payment_method": "pix",
                         "full_name": "Cliente Teste", "phone": "71999999999",
                         "address": "Rua Teste 10", "neighborhood": "Centro", "city": "Aracaju"},
            "national_shipping": {"destination_postal_code": "49010000",
                                  "service": "economico_simulado", "state": "SE",
                                  "expected_price": "16.00"},
        }

    def race(self, same_key):
        barrier = Barrier(2)

        def buy(index):
            try:
                body = deepcopy(self.payload)
                body["idempotency_key"] = "national-race-shared" if same_key else f"national-race-{index}"
                barrier.wait(timeout=10)
                response = APIClient().post("/api/v1/checkout/whatsapp/", body,
                                            format="json", HTTP_X_STORE_SLUG=self.store.slug)
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(buy, i) for i in range(2)]
            results = [f.result(timeout=30) for f in futures]
        self.assertEqual(SaleOrder.objects.filter(store=self.store).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 0)
        return results

    def test_distinct_orders_compete_for_last_unit(self):
        results = self.race(False)
        self.assertEqual(results.count(200), 1, results)
        self.assertTrue(all(code in (200, 400, 409, 422) for code in results), results)

    def test_same_idempotency_key_does_not_duplicate_order(self):
        self.assertEqual(self.race(True), [200, 200])
