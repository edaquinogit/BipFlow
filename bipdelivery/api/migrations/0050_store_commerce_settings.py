"""Online-sales foundation -- Fase A: per-store commercial configuration.

Additive and deterministic:
  * creates the StoreCommerceSettings table (all defaults reproduce the
    behaviour that existed before it -- orders on, delivery + pickup on, no
    minimum, every payment method accepted);
  * backfills one default row per existing Store so every tenant already has
    an explicit config (onboarding + get_for_store() cover future stores).

Safe on SQLite and PostgreSQL: only boolean/decimal CheckConstraints and a
data migration that inserts default rows.
"""

from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


def create_default_commerce_settings(apps, schema_editor):
    """Give every existing store an explicit, behaviour-preserving config."""
    Store = apps.get_model("api", "Store")
    StoreCommerceSettings = apps.get_model("api", "StoreCommerceSettings")

    existing_store_ids = set(
        StoreCommerceSettings.objects.values_list("store_id", flat=True)
    )
    rows = [
        StoreCommerceSettings(store_id=store_id)
        for store_id in Store.objects.values_list("id", flat=True)
        if store_id not in existing_store_ids
    ]
    if rows:
        StoreCommerceSettings.objects.bulk_create(rows)


def drop_commerce_settings(apps, schema_editor):
    """Reverse of the backfill: remove every row (table drop handles the rest)."""
    StoreCommerceSettings = apps.get_model("api", "StoreCommerceSettings")
    StoreCommerceSettings.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0049_backfill_hero_banner"),
    ]

    operations = [
        migrations.CreateModel(
            name="StoreCommerceSettings",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "orders_enabled",
                    models.BooleanField(
                        default=True,
                        help_text="Whether the storefront currently accepts new orders.",
                    ),
                ),
                (
                    "delivery_enabled",
                    models.BooleanField(
                        default=True, help_text="Whether delivery is offered."
                    ),
                ),
                (
                    "pickup_enabled",
                    models.BooleanField(
                        default=True, help_text="Whether in-store pickup is offered."
                    ),
                ),
                (
                    "minimum_order_value",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        help_text="Minimum products subtotal (before delivery fee) to place an order.",
                        max_digits=10,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0.00"))
                        ],
                    ),
                ),
                ("accepts_pix", models.BooleanField(default=True)),
                ("accepts_card", models.BooleanField(default=True)),
                ("accepts_cash", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "store",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="commerce_settings",
                        to="api.store",
                    ),
                ),
            ],
            options={
                "verbose_name": "Store commerce settings",
                "verbose_name_plural": "Store commerce settings",
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("minimum_order_value__gte", Decimal("0.00"))
                        ),
                        name="commerce_minimum_order_value_non_negative",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("orders_enabled", False),
                            ("delivery_enabled", True),
                            ("pickup_enabled", True),
                            _connector="OR",
                        ),
                        name="commerce_open_store_needs_a_delivery_mode",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("orders_enabled", False),
                            ("accepts_pix", True),
                            ("accepts_card", True),
                            ("accepts_cash", True),
                            _connector="OR",
                        ),
                        name="commerce_open_store_needs_a_payment_method",
                    ),
                ],
            },
        ),
        migrations.RunPython(
            create_default_commerce_settings, drop_commerce_settings
        ),
    ]
