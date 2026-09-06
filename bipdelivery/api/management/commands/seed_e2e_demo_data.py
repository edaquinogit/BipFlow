from __future__ import annotations

import base64
from decimal import Decimal

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from bipdelivery.api.models import (
    Category,
    DeliveryRegion,
    Product,
    ProductVariant,
    Store,
)

# 1x1 transparent PNG -- product_sync.cy.ts's "absolute URLs for product
# images" check needs a real <img> to exist somewhere in the table, and
# ImageField requires actual (however minimal) image bytes, not just a
# filename.
_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class Command(BaseCommand):
    """Seed the minimum catalog data the E2E suite needs to exercise real flows.

    `seed_dashboard_roles` only provisions an authenticated user -- a freshly
    migrated database still has zero products, so any spec that needs one
    (product listing/image checks, QR label printing, WhatsApp checkout,
    which needs a store phone number to build a wa.me link) fails not
    because of a real bug, but because there is nothing to select. Idempotent
    (get_or_create throughout), safe to run on every CI job and on an
    already-seeded local dev database alike.
    """

    help = "Seed a demo store/category/product/delivery-region for the E2E suite."

    def handle(self, *args, **options) -> None:
        store = Store.get_default()

        if not store.whatsapp_phone:
            store.whatsapp_phone = "71999990000"
            store.save(update_fields=["whatsapp_phone"])

        DeliveryRegion.objects.get_or_create(
            store=store,
            name="Centro",
            defaults={"delivery_fee": Decimal("5.00")},
        )

        category, _ = Category.objects.get_or_create(
            store=store,
            name="Geral",
        )

        Product.objects.get_or_create(
            store=store,
            name="Produto Demo E2E",
            defaults={
                "category": category,
                "price": Decimal("29.90"),
                "stock_quantity": 25,
                "is_available": True,
                "size": "M",
                "image": ContentFile(_ONE_PIXEL_PNG, name="produto-demo-e2e.png"),
            },
        )

        # A second product WITH colour variants, one inheriting the base price
        # and one with its own -- exercises the variant-pricing flow end to end
        # (product-variant-pricing.md). The variant-less product above is left
        # untouched so the existing critical-purchase smoke stays valid.
        variable_product, _ = Product.objects.get_or_create(
            store=store,
            name="Produto Variavel E2E",
            defaults={
                "category": category,
                "price": Decimal("50.00"),
                "stock_quantity": 40,
                "is_available": True,
            },
        )
        ProductVariant.objects.get_or_create(
            product=variable_product,
            name="P",
            defaults={
                "color_hex": "#111827",
                "price": None,
                "stock_quantity": 20,
                "position": 0,
            },
        )
        ProductVariant.objects.get_or_create(
            product=variable_product,
            name="GG",
            defaults={
                "color_hex": "#B91C1C",
                "price": Decimal("70.00"),
                "stock_quantity": 20,
                "position": 1,
            },
        )

        # A handful of extra simple products. checkout-visual-audit.cy.ts adds
        # three *distinct* cart lines (addDistinctProductsToCart) and asserts
        # `[data-cy="add-to-cart-button"]` has length >= 3, which the two
        # products above cannot satisfy. Idempotent, in stock, no variants.
        for index in range(4):
            Product.objects.get_or_create(
                store=store,
                name=f"Produto Vitrine E2E {index:02d}",
                defaults={
                    "category": category,
                    "price": Decimal("24.90") + index,
                    "stock_quantity": 30,
                    "is_available": True,
                },
            )

        self.stdout.write(self.style.SUCCESS(f'Demo catalog ready for store "{store.slug}".'))
