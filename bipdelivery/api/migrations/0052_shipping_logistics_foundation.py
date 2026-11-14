"""Shipping logistics foundation (stage 1).

Adds optional product dimensions and disabled-by-default, per-store
configuration. Existing local delivery fees and checkout data are untouched.
"""

from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


def create_shipping_settings_for_existing_stores(apps, schema_editor):
    Store = apps.get_model("api", "Store")
    StoreShippingSettings = apps.get_model("api", "StoreShippingSettings")
    existing_ids = set(
        StoreShippingSettings.objects.values_list("store_id", flat=True)
    )
    rows = [
        StoreShippingSettings(store_id=store_id)
        for store_id in Store.objects.values_list("id", flat=True)
        if store_id not in existing_ids
    ]
    if rows:
        StoreShippingSettings.objects.bulk_create(rows)


def remove_shipping_settings_for_existing_stores(apps, schema_editor):
    StoreShippingSettings = apps.get_model("api", "StoreShippingSettings")
    StoreShippingSettings.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0051_saleorder_payment_lifecycle"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="weight_grams",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Product weight in grams, excluding packaging.",
                null=True,
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="length_cm",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Product length in centimetres.",
                max_digits=7,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="width_cm",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Product width in centimetres.",
                max_digits=7,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="height_cm",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Product height in centimetres.",
                max_digits=7,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.CreateModel(
            name="StoreShippingSettings",
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
                    "national_shipping_enabled",
                    models.BooleanField(
                        default=False,
                        help_text="Enables national-shipping features for this store when implemented.",
                    ),
                ),
                (
                    "origin_postal_code",
                    models.CharField(
                        blank=True,
                        default="",
                        help_text="CEP de origem com 8 digitos, somente numeros.",
                        max_length=8,
                        validators=[
                            django.core.validators.RegexValidator(
                                regex="^\\d{8}$",
                                message="Informe o CEP de origem com 8 digitos.",
                            )
                        ],
                    ),
                ),
                (
                    "packaging_weight_grams",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Peso adicional padrao da embalagem, em gramas.",
                    ),
                ),
                (
                    "package_options",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text=(
                            "Lista de caixas: name, length_cm, width_cm, height_cm e "
                            "tare_weight_grams. Medidas em centimetros."
                        ),
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "store",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="shipping_settings",
                        to="api.store",
                    ),
                ),
            ],
            options={
                "verbose_name": "Store shipping settings",
                "verbose_name_plural": "Store shipping settings",
            },
        ),
        migrations.RunPython(
            create_shipping_settings_for_existing_stores,
            remove_shipping_settings_for_existing_stores,
        ),
    ]
