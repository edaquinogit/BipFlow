"""Ciclo 9: hero carousel banners and the products-only public category list.

StorefrontBanner now carries a `placement` (hero | promotion) so one
tenant-scoped, ordered, CRUD-managed model backs both the main carousel and
the pre-existing promotional rail without the two lists ever interleaving --
each has its own position numbering and reorder validation.
"""
import importlib
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import (
    Category,
    Product,
    Store,
    StorefrontAppearance,
    StorefrontBanner,
    StoreMembership,
)

User = get_user_model()


class StorefrontHeroBannerPlacementTest(TestCase):
    """Hero and promotion banners are independently ordered per store."""

    def setUp(self) -> None:
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.user = User.objects.create_user(
            username="hero_banner_owner", password="testpass123"
        )
        StoreMembership.objects.create(
            store=self.store_a, user=self.user, role=StoreMembership.ROLE_OWNER
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user, token={"store_id": self.store_a.id})

    def _list_url(self, placement: str | None = None) -> str:
        base = "/api/v1/store/current/storefront-banners/"
        return f"{base}?placement={placement}" if placement else base

    def _detail_url(self, banner: StorefrontBanner) -> str:
        return f"/api/v1/store/current/storefront-banners/{banner.id}/"

    def _reorder_url(self) -> str:
        return "/api/v1/store/current/storefront-banners/reorder/"

    def _public_url(self, slug: str) -> str:
        return f"/api/v1/public/stores/{slug}/banners/"

    def test_creates_multiple_hero_banners_independent_of_promotions(self) -> None:
        first_hero = self.client.post(
            self._list_url(),
            {
                "placement": "hero",
                "image_url": "https://cdn.example.com/hero-1.png",
                "alt_text": "Colecao verao",
            },
            format="json",
        )
        second_hero = self.client.post(
            self._list_url(),
            {
                "placement": "hero",
                "image_url": "https://cdn.example.com/hero-2.png",
            },
            format="json",
        )
        promotion = self.client.post(
            self._list_url(),
            {
                "placement": "promotion",
                "image_url": "https://cdn.example.com/promo.png",
            },
            format="json",
        )

        self.assertEqual(first_hero.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first_hero.data["position"], 0)
        self.assertEqual(second_hero.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_hero.data["position"], 1)
        # Promotions get their own position sequence, unaffected by the two
        # hero banners already created.
        self.assertEqual(promotion.status_code, status.HTTP_201_CREATED)
        self.assertEqual(promotion.data["position"], 0)

        hero_list = self.client.get(self._list_url("hero"))
        promo_list = self.client.get(self._list_url("promotion"))
        self.assertEqual(len(hero_list.data), 2)
        self.assertEqual(len(promo_list.data), 1)

    def test_default_placement_without_query_param_is_promotion(self) -> None:
        """Backward compatibility: existing callers that never mention
        placement keep seeing/creating promotion banners exactly as before."""
        create_response = self.client.post(
            self._list_url(),
            {"image_url": "https://cdn.example.com/legacy.png"},
            format="json",
        )
        self.assertEqual(create_response.data["placement"], "promotion")

        list_response = self.client.get(self._list_url())
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]["placement"], "promotion")

    def test_reorder_is_scoped_to_one_placement(self) -> None:
        hero_first = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/h1.png", position=0
        )
        hero_second = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/h2.png", position=1
        )
        promo = StorefrontBanner.objects.create(
            store=self.store_a, placement="promotion", image_url="https://cdn.example.com/p1.png", position=0
        )

        response = self.client.post(
            self._reorder_url(),
            {"placement": "hero", "ids": [hero_second.id, hero_first.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        hero_first.refresh_from_db()
        hero_second.refresh_from_db()
        promo.refresh_from_db()
        self.assertEqual(hero_second.position, 0)
        self.assertEqual(hero_first.position, 1)
        # Promotion banner untouched by the hero-scoped reorder.
        self.assertEqual(promo.position, 0)

    def test_reorder_rejects_ids_from_the_other_placement(self) -> None:
        hero = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/h1.png"
        )
        promo = StorefrontBanner.objects.create(
            store=self.store_a, placement="promotion", image_url="https://cdn.example.com/p1.png"
        )

        response = self.client.post(
            self._reorder_url(),
            {"placement": "hero", "ids": [hero.id, promo.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_reindexes_only_the_deleted_banners_placement(self) -> None:
        hero_a = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/ha.png", position=0
        )
        hero_b = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/hb.png", position=1
        )
        promo = StorefrontBanner.objects.create(
            store=self.store_a, placement="promotion", image_url="https://cdn.example.com/pa.png", position=0
        )

        delete_response = self.client.delete(self._detail_url(hero_a))

        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        hero_b.refresh_from_db()
        promo.refresh_from_db()
        self.assertEqual(hero_b.position, 0)
        self.assertEqual(promo.position, 0)

    def test_cross_tenant_forged_placement_ids_are_rejected_on_reorder(self) -> None:
        own_hero = StorefrontBanner.objects.create(
            store=self.store_a, placement="hero", image_url="https://cdn.example.com/own.png"
        )
        other_hero = StorefrontBanner.objects.create(
            store=self.store_b, placement="hero", image_url="https://cdn.example.com/other.png"
        )

        response = self.client.post(
            self._reorder_url(),
            {"placement": "hero", "ids": [own_hero.id, other_hero.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_member_without_access_cannot_list_or_create_hero_banners(self) -> None:
        outsider = User.objects.create_user(username="outsider", password="testpass123")
        client = APIClient()
        client.force_authenticate(user=outsider, token={"store_id": self.store_a.id})

        list_response = client.get(self._list_url("hero"))
        create_response = client.post(
            self._list_url(),
            {"placement": "hero", "image_url": "https://cdn.example.com/x.png"},
            format="json",
        )

        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_superuser_can_manage_hero_banners_for_any_store(self) -> None:
        superuser = User.objects.create_superuser(
            username="root-hero", password="testpass123", email="root-hero@example.com"
        )
        client = APIClient()
        client.force_authenticate(user=superuser, token={"store_id": self.store_b.id})

        response = client.post(
            self._list_url(),
            {"placement": "hero", "image_url": "https://cdn.example.com/root.png"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            StorefrontBanner.objects.filter(store=self.store_b, placement="hero").exists()
        )

    def test_invalid_placement_query_param_is_rejected(self) -> None:
        response = self.client.get(self._list_url("nonsense"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_hero_image_url_validated_the_same_as_promotion(self) -> None:
        response = self.client.post(
            self._list_url(),
            {
                "placement": "hero",
                "image_url": (
                    f"http://testserver/media/stores/{self.store_b.id}/"
                    "storefront/promotions/hero.png"
                ),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("image_url", response.data)

    def test_public_endpoint_returns_both_placements_hero_first(self) -> None:
        StorefrontBanner.objects.create(
            store=self.store_a,
            placement="promotion",
            image_url="https://cdn.example.com/promo.png",
            title="Promo ativa",
            position=0,
        )
        StorefrontBanner.objects.create(
            store=self.store_a,
            placement="hero",
            image_url="https://cdn.example.com/hero.png",
            title="Hero ativo",
            position=0,
        )
        StorefrontBanner.objects.create(
            store=self.store_a,
            placement="hero",
            image_url="https://cdn.example.com/hero-inactive.png",
            title="Hero inativo",
            position=1,
            is_active=False,
        )

        response = APIClient().get(self._public_url(self.store_a.slug))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = [(item["placement"], item["title"]) for item in response.data]
        self.assertEqual(payload, [("hero", "Hero ativo"), ("promotion", "Promo ativa")])

    def test_public_endpoint_never_leaks_another_stores_hero_banner(self) -> None:
        StorefrontBanner.objects.create(
            store=self.store_b,
            placement="hero",
            image_url="https://cdn.example.com/other-store-hero.png",
            title="Nao deveria aparecer",
        )
        StorefrontBanner.objects.create(
            store=self.store_a,
            placement="hero",
            image_url="https://cdn.example.com/own-hero.png",
            title="Loja A",
        )

        response = APIClient().get(self._public_url(self.store_a.slug))

        titles = [item["title"] for item in response.data]
        self.assertEqual(titles, ["Loja A"])


class StorefrontHeroBannerBackfillMigrationTest(TestCase):
    """Data migration 0049: existing single hero images become a hero banner."""

    def _run_backfill(self) -> None:
        # Migration module names start with digits, so they aren't valid
        # Python identifiers for a plain `import` statement -- load by path.
        backfill_module = importlib.import_module(
            "bipdelivery.api.migrations.0049_backfill_hero_banner"
        )

        # apps.get_model() in the real migration returns historical models;
        # calling the pure function against the current models is equivalent
        # here because the fields it touches (hero_*, StorefrontBanner.*)
        # have not changed shape since this migration was written.
        historical_apps = type(
            "HistoricalApps",
            (),
            {
                "get_model": staticmethod(
                    lambda app, name: {
                        "StorefrontAppearance": StorefrontAppearance,
                        "StorefrontBanner": StorefrontBanner,
                    }[name]
                )
            },
        )()
        backfill_module.backfill_hero_banners(apps=historical_apps, schema_editor=None)

    def test_existing_hero_image_becomes_a_hero_banner(self) -> None:
        store = Store.get_default()
        appearance = StorefrontAppearance.get_for_store(store)
        appearance.hero_enabled = True
        appearance.hero_image_desktop = "https://cdn.example.com/legacy-hero.png"
        appearance.hero_image_mobile = "https://cdn.example.com/legacy-hero-mobile.png"
        appearance.hero_alt_text = "Banner antigo"
        appearance.hero_title = "Bem-vindo"
        appearance.hero_destination_type = "products"
        appearance.save()

        self._run_backfill()

        banner = StorefrontBanner.objects.get(store=store, placement="hero")
        self.assertEqual(banner.image_url, "https://cdn.example.com/legacy-hero.png")
        self.assertEqual(banner.image_url_mobile, "https://cdn.example.com/legacy-hero-mobile.png")
        self.assertEqual(banner.alt_text, "Banner antigo")
        self.assertEqual(banner.title, "Bem-vindo")
        self.assertTrue(banner.is_active)
        # The legacy field is left untouched -- non-destructive migration.
        appearance.refresh_from_db()
        self.assertEqual(appearance.hero_image_desktop, "https://cdn.example.com/legacy-hero.png")

    def test_disabled_or_empty_hero_is_not_backfilled(self) -> None:
        store = Store.get_default()
        appearance = StorefrontAppearance.get_for_store(store)
        appearance.hero_enabled = False
        appearance.hero_image_desktop = "https://cdn.example.com/unused.png"
        appearance.save()

        self._run_backfill()

        self.assertFalse(
            StorefrontBanner.objects.filter(store=store, placement="hero").exists()
        )

    def test_backfill_is_idempotent(self) -> None:
        store = Store.get_default()
        appearance = StorefrontAppearance.get_for_store(store)
        appearance.hero_enabled = True
        appearance.hero_image_desktop = "https://cdn.example.com/legacy-hero.png"
        appearance.save()

        self._run_backfill()
        self._run_backfill()

        self.assertEqual(
            StorefrontBanner.objects.filter(store=store, placement="hero").count(), 1
        )


class PublicCategoryVisibilityTest(TestCase):
    """Ciclo 9: the public category nav only lists categories with products."""

    def setUp(self) -> None:
        self.store = Store.get_default()
        self.other_store = Store.objects.create(name="Loja B", slug="loja-b")

    def _url(self) -> str:
        return "/api/v1/categories/"

    def test_anonymous_request_only_lists_categories_with_products(self) -> None:
        with_products = Category.objects.create(
            name="Calcas", slug="calcas", store=self.store
        )
        Product.objects.create(
            name="Calca jeans",
            price=Decimal("99.90"),
            category=with_products,
            store=self.store,
        )
        empty_category = Category.objects.create(
            name="Vazia", slug="vazia", store=self.store
        )

        response = APIClient().get(self._url())

        names = [item["name"] for item in response.data["results"]]
        self.assertIn("Calcas", names)
        self.assertNotIn(empty_category.name, names)

    def test_anonymous_request_never_sees_another_stores_categories(self) -> None:
        own_category = Category.objects.create(
            name="Botas", slug="botas", store=self.store
        )
        Product.objects.create(
            name="Bota de couro",
            price=Decimal("199.90"),
            category=own_category,
            store=self.store,
        )
        other_category = Category.objects.create(
            name="Categoria de outra loja", slug="outra", store=self.other_store
        )
        Product.objects.create(
            name="Produto de outra loja",
            price=Decimal("10.00"),
            category=other_category,
            store=self.other_store,
        )

        response = APIClient().get(self._url())

        names = [item["name"] for item in response.data["results"]]
        self.assertIn("Botas", names)
        self.assertNotIn("Categoria de outra loja", names)

    def test_dashboard_user_still_sees_empty_categories(self) -> None:
        user = User.objects.create_user(username="cat_owner", password="testpass123")
        StoreMembership.objects.create(
            store=self.store, user=user, role=StoreMembership.ROLE_OWNER
        )
        empty_category = Category.objects.create(
            name="Nova categoria", slug="nova", store=self.store
        )
        client = APIClient()
        client.force_authenticate(user=user, token={"store_id": self.store.id})

        response = client.get(self._url())

        names = [item["name"] for item in response.data["results"]]
        self.assertIn(empty_category.name, names)
