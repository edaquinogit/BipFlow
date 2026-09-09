"""Online-sales foundation -- Fase C: payment lifecycle on SaleOrder.

Additive and deterministic:
  * adds payment_status / paid_at / refunded_at / payment_reference to
    SaleOrder (payment_status defaults to "pending");
  * adds the append-only PaymentStatusEvent audit table;
  * backfills historical orders -- a cancelled order becomes payment
    "cancelled", every other historical order stays "pending" (we never
    declare money received without evidence, and never invent paid_at).

Safe on SQLite and PostgreSQL: plain AddField + CreateModel + a data
migration that only writes the new column.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

PAYMENT_STATUS_CHOICES = [
    ("pending", "Pending"),
    ("paid", "Paid"),
    ("failed", "Failed"),
    ("refund_pending", "Refund pending"),
    ("refunded", "Refunded"),
    ("cancelled", "Cancelled"),
]


def backfill_payment_status(apps, schema_editor):
    """Historical cancelled orders -> 'cancelled'; everything else stays 'pending'."""
    SaleOrder = apps.get_model("api", "SaleOrder")
    SaleOrder.objects.filter(status="cancelled").exclude(
        payment_status="cancelled"
    ).update(payment_status="cancelled")


def revert_payment_status(apps, schema_editor):
    """Reverse: put every row back to the column default before it is dropped."""
    SaleOrder = apps.get_model("api", "SaleOrder")
    SaleOrder.objects.exclude(payment_status="pending").update(
        payment_status="pending"
    )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0050_store_commerce_settings"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="saleorder",
            name="payment_status",
            field=models.CharField(
                choices=PAYMENT_STATUS_CHOICES,
                db_index=True,
                default="pending",
                help_text=(
                    "Whether payment was actually received (online-sales "
                    "foundation). Virtual/WhatsApp orders start 'pending'; a "
                    "completed PDV sale starts 'paid'. Transitions go through "
                    "bipdelivery/api/payments.py."
                ),
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="saleorder",
            name="paid_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="saleorder",
            name="refunded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="saleorder",
            name="payment_reference",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "Optional operator-entered reference for the "
                    "payment/refund (receipt id, transfer note). Never a card "
                    "number or gateway token."
                ),
                max_length=64,
            ),
        ),
        migrations.CreateModel(
            name="PaymentStatusEvent",
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
                    "previous_status",
                    models.CharField(choices=PAYMENT_STATUS_CHOICES, max_length=16),
                ),
                (
                    "new_status",
                    models.CharField(choices=PAYMENT_STATUS_CHOICES, max_length=16),
                ),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("system", "System"),
                            ("manual", "Manual"),
                            ("gateway", "Gateway"),
                        ],
                        default="system",
                        max_length=16,
                    ),
                ),
                ("reference", models.CharField(blank=True, default="", max_length=64)),
                ("note", models.CharField(blank=True, default="", max_length=200)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payment_status_events",
                        to="api.saleorder",
                    ),
                ),
                (
                    "performed_by",
                    models.ForeignKey(
                        blank=True,
                        help_text=(
                            "The operator who made the change, when a human "
                            "did (null for system transitions)."
                        ),
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="payment_status_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "store",
                    models.ForeignKey(
                        help_text=(
                            "Always the same store as `order` -- denormalized "
                            "for tenant-scoped queries."
                        ),
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payment_status_events",
                        to="api.store",
                    ),
                ),
            ],
            options={
                "ordering": ["id"],
                "indexes": [
                    models.Index(
                        fields=["order", "id"], name="api_payment_order_i_c6a0ed_idx"
                    ),
                    models.Index(
                        fields=["store", "created_at"],
                        name="api_payment_store_i_ed9bb0_idx",
                    ),
                ],
            },
        ),
        migrations.RunPython(backfill_payment_status, revert_payment_status),
    ]
