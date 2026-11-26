"""Stage 1 baseline: freeze existing commercial contracts, not promotions."""
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from bipdelivery.api.models import Category, Product, ProductVariant, SaleOrder, Store
from bipdelivery.api.serializers import ProductSerializer


@override_settings(WHATSAPP_ORDER_PHONE="5571999999999")
class ProductManagementBaselineTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.store = Store.get_default()
        self.category = Category.objects.create(store=self.store, name="Baseline")
        self.product = Product.objects.create(
            store=self.store, category=self.category, name="Baseline product",
            price=Decimal("59.90"), stock_quantity=5,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product, name="Premium", color_hex="#111827",
            price=Decimal("69.90"), stock_quantity=5, position=0,
        )

    def patch(self, data):
        serializer = ProductSerializer(
            self.product, data=data, partial=True, context={"store": self.store}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.product.refresh_from_db()
        self.variant.refresh_from_db()

    def variant_payload(self, **changes):
        row = {
            "id": self.variant.pk, "name": self.variant.name,
            "color_hex": self.variant.color_hex, "position": self.variant.position,
            "is_active": True,
        }
        row.update(changes)
        return {"variants_payload": [row]}

    def test_unrelated_patch_preserves_variant_identity_price_and_stock(self):
        self.patch({"description": "Updated description"})
        self.assertEqual(self.product.variants.count(), 1)
        self.assertEqual(self.variant.price, Decimal("69.90"))
        self.assertEqual(self.variant.stock_quantity, 5)

    def test_omitted_override_preserved_null_inherits_zero_is_explicit(self):
        self.patch(self.variant_payload())
        self.assertEqual(self.variant.price, Decimal("69.90"))
        self.patch(self.variant_payload(price=None))
        self.assertIsNone(self.variant.price)
        self.assertEqual(self.product.get_effective_price(self.variant), Decimal("59.90"))
        self.patch(self.variant_payload(price="0.00"))
        self.assertEqual(self.variant.price, Decimal("0.00"))
        self.assertEqual(self.product.get_effective_price(self.variant), Decimal("0.00"))
        self.assertEqual(self.variant.stock_quantity, 5)

    def test_foreign_category_rejected_on_partial_update(self):
        other = Store.objects.create(name="Other baseline", slug="other-baseline")
        category = Category.objects.create(store=other, name="Foreign")
        serializer = ProductSerializer(
            self.product, data={"category": category.pk}, partial=True,
            context={"store": self.store},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("category", serializer.errors)
        self.product.refresh_from_db()
        self.assertEqual(self.product.category_id, self.category.pk)

    def test_idempotent_replay_preserves_price_and_stock_after_repricing(self):
        payload = {
            "idempotency_key": "product-baseline-replay",
            "items": [{"product_id": self.product.pk,
                       "variant_id": self.variant.pk, "quantity": 1}],
            "customer": {"delivery_method": "pickup", "payment_method": "pix",
                         "full_name": "Cliente Teste", "phone": "11988887777",
                         "notes": ""},
        }
        client = APIClient()
        first = client.post("/api/v1/checkout/whatsapp/", payload, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["total"], "69.90")
        self.variant.price = Decimal("89.90")
        self.variant.save(update_fields=["price"])
        second = client.post("/api/v1/checkout/whatsapp/", payload, format="json")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["order_reference"], first.data["order_reference"])
        self.assertEqual(second.data["total"], "69.90")
        self.assertEqual(SaleOrder.objects.filter(store=self.store).count(), 1)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_quantity, 4)
        self.assertEqual(SaleOrder.objects.get(
            order_reference=first.data["order_reference"]
        ).items.get().unit_price, Decimal("69.90"))
