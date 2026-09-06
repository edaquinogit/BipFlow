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
    StorefrontBanner,
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

        # Seeded *before* the two demo products below: Product ordering is
        # ["-created_at"], and product_sync.cy.ts / dashboard-storefront-menu.cy.ts
        # both expect "Produto Demo E2E" (and its image) on the first grid
        # page. Creating the bulk filler catalog first keeps the two demo
        # products newest, so they stay on page one.
        self._seed_discovery_experience(store, category)

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

        self.stdout.write(self.style.SUCCESS(f'Demo catalog ready for store "{store.slug}".'))

    # Storefront grid page size (core.settings REST_FRAMEWORK / pagination.py's
    # ProductListPagination). Every category is filled past this so page 1 is
    # always a full grid -- see _seed_discovery_experience.
    _STOREFRONT_PAGE_SIZE = 12

    def _seed_discovery_experience(self, store: Store, general_category: Category) -> None:
        """Seed the Ciclo 9 storefront discovery surfaces.

        `hero-carousel-and-categories.cy.ts` asserts a multi-slide hero and a
        promotions rail. `category-scroll-preservation.cy.ts` needs at least
        two more real categories (its back/forward test selects the 1st and
        2nd chip) AND every category -- including "Todos" -- must render a
        full first page: it scrolls ~900px down and asserts a category change
        does not move the viewport, which only holds if the grid height is the
        same before and after. A category with fewer than PAGE_SIZE products
        renders a shorter grid, the page gets shorter than the recorded scroll
        offset, and the browser clamps scrollY -- a layout fact, not a routing
        regression. So every category is filled one product past a page.

        Called from handle() *before* the two demo products so those stay
        newest (Product ordering is ["-created_at"]) and remain on page one.

        Seeded idempotently so this runs deterministically in CI instead of
        against a hand-curated local dev database.
        """

        per_category = self._STOREFRONT_PAGE_SIZE + 1

        categories = [general_category]
        for name in ("Camisetas", "Calcados"):
            extra_category, _ = Category.objects.get_or_create(store=store, name=name)
            categories.append(extra_category)

        for target_category in categories:
            for index in range(per_category):
                Product.objects.get_or_create(
                    store=store,
                    name=f"Produto Vitrine E2E {target_category.name} {index:02d}",
                    defaults={
                        "category": target_category,
                        "price": Decimal("19.90") + index,
                        "stock_quantity": 30,
                        "is_available": True,
                    },
                )

        # Hero + promotion banners. image_url points at a same-origin static
        # asset shipped with the frontend (public/brand/), so it loads
        # instantly and deterministically in CI -- no external host, no slow
        # or failing request that would collapse a carousel mid-test. Every
        # hero slide carries a title so the caption block's height never
        # changes as autoplay advances.
        hero_slides = (
            ("Novidades da semana", "Confira os lancamentos"),
            ("Entrega rapida", "Para toda a cidade"),
        )
        for position, (title, subtitle) in enumerate(hero_slides):
            StorefrontBanner.objects.get_or_create(
                store=store,
                placement=StorefrontBanner.PLACEMENT_HERO,
                title=title,
                defaults={
                    "image_url": "/brand/bipflow-og.png",
                    "image_url_mobile": "/brand/bipflow-og.png",
                    "subtitle": subtitle,
                    "position": position,
                    "is_active": True,
                },
            )
        for position in range(3):
            StorefrontBanner.objects.get_or_create(
                store=store,
                placement=StorefrontBanner.PLACEMENT_PROMOTION,
                title=f"Promocao E2E {position + 1}",
                defaults={
                    "image_url": "/brand/bipflow-og.png",
                    "image_url_mobile": "/brand/bipflow-og.png",
                    "position": position,
                    "is_active": True,
                },
            )
