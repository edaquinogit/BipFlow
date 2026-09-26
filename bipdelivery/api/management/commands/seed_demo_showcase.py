from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bipdelivery.api.models import (
    Category,
    DeliveryRegion,
    Product,
    SaleOrder,
    SaleOrderItem,
    Store,
)

# Renames pre-existing test-era products (created by hand during earlier
# development cycles) to names presentable in front of an audience, without
# touching their id, stock, images or category. Matched by their current
# (test) name so this is a no-op once the rename has happened once.
_PRESENTABLE_RENAMES: dict[str, dict[str, str]] = {
    "Teste": {
        "name": "Bota Coturno Preta",
        "description": "Bota coturno resistente, cano curto, sola emborrachada antiderrapante.",
    },
    "Produto teste": {
        "name": "Calça Jogger Premium",
        "description": "Calça jogger em moletom flanelado, punho e cintura elástica, caimento reto.",
    },
    "Produto 3": {
        "name": "Calça Legging Fitness",
        "description": "Legging de compressão em tecido tecnológico, cintura alta, ideal para treino.",
    },
}

# The "Produto 3" legging above already ships two colour variants seeded
# during manual testing; give them presentable names too (variant name is
# user-facing in the PDV/cart UI).
_VARIANT_RENAMES: dict[str, str] = {
    "preto": "Preto",
    "roda": "Roxo",
}

# New, curated catalog additions so the storefront/PDV/dashboard have a
# believable multi-category assortment instead of three leftover test SKUs.
# Idempotent (get_or_create keyed by store+name), no personal data, no
# external image hosts -- deliberately left without an `image` so the admin
# can drop in real photos later; the UI already renders a clean placeholder
# for products without one.
_NEW_PRODUCTS: list[dict] = [
    {
        "name": "Top Fitness Dry-Fit",
        "category": "Calça",
        "price": Decimal("59.90"),
        "stock_quantity": 40,
        "size": "M",
        "description": "Top esportivo em tecido dry-fit, alta sustentação, costura plana.",
    },
    {
        "name": "Jaqueta Corta-Vento",
        "category": "Bota",
        "price": Decimal("149.90"),
        "stock_quantity": 18,
        "size": "G",
        "description": "Jaqueta corta-vento leve, capuz removível, bolsos com zíper.",
    },
    {
        "name": "Tênis Training Performance",
        "category": "Bota",
        "price": Decimal("219.90"),
        "stock_quantity": 22,
        "size": "40",
        "description": "Tênis para treino funcional, entressola amortecida, solado antiderrapante.",
    },
    {
        "name": "Camiseta Básica Algodão",
        "category": "Calça",
        "price": Decimal("39.90"),
        "stock_quantity": 60,
        "size": "P",
        "description": "Camiseta 100% algodão, corte reto, gola careca reforçada.",
    },
]

# A believable delivery zone so checkout/PDV delivery flows have at least one
# region to resolve against (production currently has zero -- online delivery
# quietly falls back to "unavailable" without this).
_DELIVERY_REGIONS: list[dict] = [
    {"name": "Centro", "delivery_fee": Decimal("8.00")},
    {"name": "Bairro / Região próxima", "delivery_fee": Decimal("14.00")},
]

# Synthetic historical orders for the Pedidos dashboard. Customer identity is
# intentionally a generic demo label, never a real name/phone/email, so
# nothing personally identifiable is exposed on screen during the
# presentation. Dates are spread over the past few days so the list/timeline
# doesn't look like it was created seconds ago.
_SYNTHETIC_ORDERS: list[dict] = [
    {
        "reference": "DEMO-0001",
        "days_ago": 3,
        "channel": SaleOrder.CHANNEL_VIRTUAL,
        "delivery_method": "delivery",
        "payment_method": "pix",
        "payment_status": SaleOrder.PAYMENT_STATUS_PAID,
        "status": SaleOrder.STATUS_DELIVERED,
    },
    {
        "reference": "DEMO-0002",
        "days_ago": 2,
        "channel": SaleOrder.CHANNEL_LOJA_FISICA,
        "delivery_method": "pickup",
        "payment_method": "cash",
        "payment_status": SaleOrder.PAYMENT_STATUS_PAID,
        "status": SaleOrder.STATUS_DELIVERED,
    },
    {
        "reference": "DEMO-0003",
        "days_ago": 1,
        "channel": SaleOrder.CHANNEL_VIRTUAL,
        "delivery_method": "delivery",
        "payment_method": "card",
        "payment_status": SaleOrder.PAYMENT_STATUS_PENDING,
        "status": SaleOrder.STATUS_PREPARED,
    },
]


class Command(BaseCommand):
    """Curate the default store's catalog/orders for an in-person demo.

    Unlike `seed_e2e_demo_data` (CI fixtures, deliberately named "... E2E" and
    full of filler pages), this is meant to be run once, by hand, against a
    real environment right before showing the product to someone: it renames
    the handful of leftover test-era products to presentable names, adds a
    small curated assortment so the catalog clears a believable minimum, adds
    a delivery region, and creates a few synthetic historical orders with no
    personal data. Idempotent (get_or_create / match-by-name throughout) --
    safe to run more than once.

    Prints an exact manifest of every row it touched, so running it leaves a
    clear record of what changed.
    """

    help = "Curate the default store's catalog and order history for a live demo."

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        store = Store.get_default()
        created: list[str] = []
        renamed: list[str] = []

        for old_name, fields in _PRESENTABLE_RENAMES.items():
            product = Product.objects.filter(store=store, name=old_name).first()
            if product is None:
                continue
            new_name = fields["name"]
            if product.name == new_name:
                continue
            product.name = new_name
            product.description = fields["description"]
            product.save(update_fields=["name", "description"])
            renamed.append(f'product "{old_name}" -> "{new_name}"')

            for variant in product.variants.all():
                new_variant_name = _VARIANT_RENAMES.get(variant.name)
                if new_variant_name and variant.name != new_variant_name:
                    old_variant_name = variant.name
                    variant.name = new_variant_name
                    variant.save(update_fields=["name"])
                    renamed.append(
                        f'variant "{old_variant_name}" -> "{new_variant_name}" '
                        f'(product "{new_name}")'
                    )

        for spec in _NEW_PRODUCTS:
            category, _ = Category.objects.get_or_create(
                store=store, name=spec["category"]
            )
            _, was_created = Product.objects.get_or_create(
                store=store,
                name=spec["name"],
                defaults={
                    "category": category,
                    "price": spec["price"],
                    "stock_quantity": spec["stock_quantity"],
                    "size": spec["size"],
                    "description": spec["description"],
                    "is_available": True,
                },
            )
            if was_created:
                created.append(f'product "{spec["name"]}"')

        for spec in _DELIVERY_REGIONS:
            _, was_created = DeliveryRegion.objects.get_or_create(
                store=store,
                name=spec["name"],
                defaults={"delivery_fee": spec["delivery_fee"]},
            )
            if was_created:
                created.append(f'delivery region "{spec["name"]}"')

        catalog_products = list(Product.objects.filter(store=store).order_by("id"))
        for spec in _SYNTHETIC_ORDERS:
            if SaleOrder.objects.filter(
                store=store, order_reference=spec["reference"]
            ).exists():
                continue
            if not catalog_products:
                break
            product = catalog_products[len(created) % len(catalog_products)]
            unit_price = product.price
            delivery_fee = (
                Decimal("8.00") if spec["delivery_method"] == "delivery" else Decimal("0.00")
            )
            order = SaleOrder.objects.create(
                store=store,
                order_reference=spec["reference"],
                status=spec["status"],
                channel=spec["channel"],
                customer_name="Cliente Demonstração",
                customer_phone="+55 00 00000-0000",
                delivery_method=spec["delivery_method"],
                payment_method=spec["payment_method"],
                payment_status=spec["payment_status"],
                subtotal=unit_price,
                delivery_fee=delivery_fee,
                total=unit_price + delivery_fee,
                paid_at=timezone.now() if spec["payment_status"] == SaleOrder.PAYMENT_STATUS_PAID else None,
            )
            SaleOrderItem.objects.create(
                order=order,
                product=product,
                product_name=product.name,
                unit_price=unit_price,
                quantity=1,
                line_total=unit_price,
            )
            order.created_at = timezone.now() - timezone.timedelta(
                days=spec["days_ago"]
            )
            order.save(update_fields=["created_at"])
            created.append(f'order "{spec["reference"]}"')

        self.stdout.write(self.style.SUCCESS(f'Demo showcase ready for store "{store.slug}".'))
        if renamed:
            self.stdout.write("Renamed:")
            for line in renamed:
                self.stdout.write(f"  - {line}")
        if created:
            self.stdout.write("Created:")
            for line in created:
                self.stdout.write(f"  - {line}")
        if not renamed and not created:
            self.stdout.write("Nothing to do -- already curated.")
