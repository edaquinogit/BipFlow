"""Backfill StorefrontAppearance.hero_* into a StorefrontBanner(placement="hero") row.

Non-destructive: the legacy hero_* columns on StorefrontAppearance are left
untouched (still readable, still the source of truth until this migration
runs) -- this only *adds* an equivalent StorefrontBanner row so the new
multi-banner hero carousel has something to show without any store losing
the hero image it already configured.
"""
from django.db import migrations


def backfill_hero_banners(apps, schema_editor):
    StorefrontAppearance = apps.get_model("api", "StorefrontAppearance")
    StorefrontBanner = apps.get_model("api", "StorefrontBanner")

    appearances = StorefrontAppearance.objects.exclude(hero_image_desktop="").filter(
        hero_enabled=True,
    )
    for appearance in appearances.iterator():
        already_migrated = StorefrontBanner.objects.filter(
            store_id=appearance.store_id, placement="hero"
        ).exists()
        if already_migrated:
            continue

        StorefrontBanner.objects.create(
            store_id=appearance.store_id,
            placement="hero",
            image_url=appearance.hero_image_desktop,
            image_url_mobile=appearance.hero_image_mobile,
            alt_text=appearance.hero_alt_text,
            title=appearance.hero_title,
            subtitle=appearance.hero_subtitle,
            cta_text=appearance.hero_cta_text,
            destination_type=appearance.hero_destination_type or "none",
            destination_value=appearance.hero_destination_value,
            button_url=appearance.hero_cta_url,
            position=0,
            is_active=True,
        )


def noop_reverse(apps, schema_editor):
    """Intentionally not reversed: the legacy hero_* fields this was built
    from are still intact, so nothing is lost by leaving the backfilled
    StorefrontBanner rows in place on a rollback."""


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0048_storefront_banner_placement"),
    ]

    operations = [
        migrations.RunPython(backfill_hero_banners, noop_reverse),
    ]
