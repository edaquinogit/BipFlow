from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class ShippingSnapshotMigrationTests(TransactionTestCase):
    before = ("api", "0052_shipping_logistics_foundation")
    after = ("api", "0053_saleorder_shipping_snapshot")

    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate([target])
        return executor.loader.project_state([target]).apps

    def test_legacy_order_forward_and_reverse(self):
        self.addCleanup(self.migrate, self.after)
        old = self.migrate(self.before)
        store = old.get_model("api", "Store").objects.create(
            name="Legacy snapshot", slug="legacy-snapshot"
        )
        order = old.get_model("api", "SaleOrder").objects.create(
            store_id=store.pk, order_reference="LEGACY-SNAPSHOT",
            customer_name="Legacy", customer_phone="71999999999",
            delivery_method="delivery", payment_method="pix",
            subtotal="20.00", delivery_fee="7.50", total="27.50",
        )
        new = self.migrate(self.after)
        migrated = new.get_model("api", "SaleOrder").objects.get(pk=order.pk)
        self.assertEqual(migrated.shipping_snapshot, {})
        self.assertEqual(migrated.total, Decimal("27.50"))
        migrated.shipping_snapshot = {"kind": "national_simulated"}
        migrated.save(update_fields=["shipping_snapshot"])
        old = self.migrate(self.before)
        restored = old.get_model("api", "SaleOrder").objects.get(pk=order.pk)
        self.assertEqual(restored.delivery_fee, Decimal("7.50"))
        self.assertEqual(restored.total, Decimal("27.50"))
