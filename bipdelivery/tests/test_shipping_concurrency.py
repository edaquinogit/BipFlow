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
