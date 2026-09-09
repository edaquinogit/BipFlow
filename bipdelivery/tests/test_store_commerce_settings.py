"""Online-sales foundation -- Fase A: per-store commercial configuration.

Covers the StoreCommerceSettings model (defaults, invariants, isolation),
the dashboard endpoint (GET/PATCH, RBAC), the public projection, and that a
new store gets a default config through onboarding.
"""
from decimal import Decimal
from typing import Any

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.utils import IntegrityError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import Store, StoreCommerceSettings, StoreMembership

User = get_user_model()

ADMIN_URL = "/api/v1/store/current/commerce-settings/"


def public_url(slug: str) -> str:
    return f"/api/v1/public/stores/{slug}/commerce-settings/"


def make_member(store: Store, *, role: str, username: str) -> Any:
    user = User.objects.create_user(username=username, password="pw-12345678")
    StoreMembership.objects.create(store=store, user=user, role=role)
    return user


def auth(client: APIClient, user: Any, store: Store) -> None:
    client.force_authenticate(user=user, token={"store_id": store.id})


class CommerceSettingsModelTest(TestCase):
    def test_defaults_preserve_current_behaviour(self) -> None:
        cfg = StoreCommerceSettings.get_for_store(Store.get_default())

        self.assertTrue(cfg.orders_enabled)
        self.assertTrue(cfg.delivery_enabled)
        self.assertTrue(cfg.pickup_enabled)
        self.assertEqual(cfg.minimum_order_value, Decimal("0.00"))
        self.assertTrue(cfg.accepts_pix)
        self.assertTrue(cfg.accepts_card)
        self.assertTrue(cfg.accepts_cash)
        self.assertEqual(cfg.enabled_delivery_methods, ["delivery", "pickup"])
        self.assertEqual(cfg.enabled_payment_methods, ["pix", "card", "cash"])

    def test_get_for_store_is_idempotent(self) -> None:
        store = Store.get_default()
        first = StoreCommerceSettings.get_for_store(store)
        second = StoreCommerceSettings.get_for_store(store)

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(
            StoreCommerceSettings.objects.filter(store=store).count(), 1
        )

    def test_one_row_per_store(self) -> None:
        store = Store.get_default()
        StoreCommerceSettings.get_for_store(store)
        with self.assertRaises(IntegrityError), transaction.atomic():
            StoreCommerceSettings.objects.create(store=store)

    def test_cascade_delete_with_store(self) -> None:
        store = Store.objects.create(name="Temp", slug="temp-commerce")
        StoreCommerceSettings.get_for_store(store)
        store.delete()
        self.assertFalse(
            StoreCommerceSettings.objects.filter(store_id=store.id).exists()
        )

    def test_clean_rejects_negative_minimum(self) -> None:
        cfg = StoreCommerceSettings.get_for_store(Store.get_default())
        cfg.minimum_order_value = Decimal("-1.00")
        with self.assertRaises(ValidationError) as ctx:
            cfg.full_clean()
        self.assertIn("minimum_order_value", ctx.exception.error_dict)

    def test_clean_rejects_open_store_with_no_delivery_mode(self) -> None:
        cfg = StoreCommerceSettings.get_for_store(Store.get_default())
        cfg.orders_enabled = True
        cfg.delivery_enabled = False
        cfg.pickup_enabled = False
        with self.assertRaises(ValidationError) as ctx:
            cfg.full_clean()
        self.assertIn("delivery_enabled", ctx.exception.error_dict)

    def test_clean_rejects_open_store_with_no_payment_method(self) -> None:
        cfg = StoreCommerceSettings.get_for_store(Store.get_default())
        cfg.accepts_pix = cfg.accepts_card = cfg.accepts_cash = False
        with self.assertRaises(ValidationError) as ctx:
            cfg.full_clean()
        self.assertIn("accepts_pix", ctx.exception.error_dict)

    def test_closed_store_may_have_nothing_enabled(self) -> None:
        cfg = StoreCommerceSettings.get_for_store(Store.get_default())
        cfg.orders_enabled = False
        cfg.delivery_enabled = cfg.pickup_enabled = False
        cfg.accepts_pix = cfg.accepts_card = cfg.accepts_cash = False
        cfg.full_clean()  # must not raise
        cfg.save()

    def test_db_check_constraint_blocks_negative_minimum(self) -> None:
        store = Store.objects.create(name="CC", slug="cc-neg")
        with self.assertRaises(IntegrityError), transaction.atomic():
            StoreCommerceSettings.objects.create(
                store=store, minimum_order_value=Decimal("-5.00")
            )

    def test_onboarding_creates_a_default_config(self) -> None:
        owner = User.objects.create_user(username="ob-owner", password="pw-12345678")
        store = Store.create_for_owner(name="Nova Loja", owner=owner)
        self.assertTrue(
            StoreCommerceSettings.objects.filter(store=store).exists()
        )
        cfg = store.commerce_settings
        self.assertTrue(cfg.orders_enabled)


class CommerceSettingsAdminEndpointTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner")
        self.manager = make_member(self.store, role=StoreMembership.ROLE_MANAGER, username="manager")
        self.viewer = make_member(self.store, role=StoreMembership.ROLE_VIEWER, username="viewer")

    def test_requires_authentication(self) -> None:
        response: Any = APIClient().get(ADMIN_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_member_reads_config_with_stable_shape(self) -> None:
        client = APIClient()
        auth(client, self.viewer, self.store)
        response: Any = client.get(ADMIN_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for field in (
            "orders_enabled",
            "delivery_enabled",
            "pickup_enabled",
            "minimum_order_value",
            "accepts_pix",
            "accepts_card",
            "accepts_cash",
            "enabled_delivery_methods",
            "enabled_payment_methods",
        ):
            self.assertIn(field, response.data)
        self.assertNotIn("id", response.data)
        self.assertNotIn("store", response.data)

    def test_owner_can_patch(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)
        response: Any = client.patch(
            ADMIN_URL, {"minimum_order_value": "50.00"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["minimum_order_value"], "50.00")

    def test_manager_can_patch(self) -> None:
        client = APIClient()
        auth(client, self.manager, self.store)
        response: Any = client.patch(
            ADMIN_URL, {"accepts_cash": False}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["accepts_cash"])

    def test_viewer_cannot_patch(self) -> None:
        client = APIClient()
        auth(client, self.viewer, self.store)
        response: Any = client.patch(
            ADMIN_URL, {"orders_enabled": False}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(
            StoreCommerceSettings.get_for_store(self.store).orders_enabled
        )

    def test_patch_rejects_invalid_combination(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)
        response: Any = client.patch(
            ADMIN_URL,
            {"delivery_enabled": False, "pickup_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_rejects_negative_minimum(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)
        response: Any = client.patch(
            ADMIN_URL, {"minimum_order_value": "-1"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_partial_patch_preserves_other_fields(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)
        client.patch(ADMIN_URL, {"minimum_order_value": "30.00"}, format="json")
        response: Any = client.patch(ADMIN_URL, {"accepts_pix": False}, format="json")
        self.assertEqual(response.data["minimum_order_value"], "30.00")
        self.assertFalse(response.data["accepts_pix"])

    def test_never_accepts_store_id_from_payload(self) -> None:
        other = Store.objects.create(name="Outra", slug="outra-cc")
        StoreCommerceSettings.get_for_store(other)
        client = APIClient()
        auth(client, self.owner, self.store)

        client.patch(
            ADMIN_URL,
            {"store": other.id, "minimum_order_value": "12.00"},
            format="json",
        )

        self.assertEqual(
            StoreCommerceSettings.get_for_store(self.store).minimum_order_value,
            Decimal("12.00"),
        )
        self.assertEqual(
            StoreCommerceSettings.get_for_store(other).minimum_order_value,
            Decimal("0.00"),
        )


class CommerceSettingsTenantIsolationTest(TestCase):
    def setUp(self) -> None:
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.owner_a = make_member(self.store_a, role=StoreMembership.ROLE_OWNER, username="owner-a")
        self.owner_b = make_member(self.store_b, role=StoreMembership.ROLE_OWNER, username="owner-b")

        cfg_b = StoreCommerceSettings.get_for_store(self.store_b)
        cfg_b.minimum_order_value = Decimal("99.00")
        cfg_b.save()

    def test_store_a_owner_cannot_read_store_b_with_stale_claim(self) -> None:
        client = APIClient()
        client.force_authenticate(
            user=self.owner_a, token={"store_id": self.store_b.id}
        )
        response: Any = client.get(ADMIN_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_store_a_owner_cannot_edit_store_b(self) -> None:
        client = APIClient()
        client.force_authenticate(
            user=self.owner_a, token={"store_id": self.store_b.id}
        )
        response: Any = client.patch(
            ADMIN_URL, {"minimum_order_value": "1.00"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            StoreCommerceSettings.get_for_store(self.store_b).minimum_order_value,
            Decimal("99.00"),
        )

    def test_foreign_x_store_slug_header_is_ignored(self) -> None:
        client = APIClient()
        auth(client, self.owner_a, self.store_a)
        response: Any = client.get(ADMIN_URL, HTTP_X_STORE_SLUG=self.store_b.slug)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["minimum_order_value"], "0.00")

    def test_each_store_edits_independently(self) -> None:
        client_a = APIClient()
        auth(client_a, self.owner_a, self.store_a)
        client_a.patch(ADMIN_URL, {"minimum_order_value": "10.00"}, format="json")

        self.assertEqual(
            StoreCommerceSettings.get_for_store(self.store_a).minimum_order_value,
            Decimal("10.00"),
        )
        self.assertEqual(
            StoreCommerceSettings.get_for_store(self.store_b).minimum_order_value,
            Decimal("99.00"),
        )


class PublicCommerceSettingsProjectionTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.objects.create(name="Loja Publica", slug="loja-publica")
        cfg = StoreCommerceSettings.get_for_store(self.store)
        cfg.minimum_order_value = Decimal("40.00")
        cfg.accepts_cash = False
        cfg.pickup_enabled = False
        cfg.save()

    def test_public_endpoint_exposes_only_sanitised_fields(self) -> None:
        response: Any = APIClient().get(public_url(self.store.slug))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(response.data.keys()),
            {
                "orders_enabled",
                "delivery_enabled",
                "pickup_enabled",
                "minimum_order_value",
                "accepts_pix",
                "accepts_card",
                "accepts_cash",
                "delivery_methods",
                "payment_methods",
            },
        )
        self.assertEqual(response.data["minimum_order_value"], "40.00")
        self.assertEqual(response.data["delivery_methods"], ["delivery"])
        self.assertEqual(response.data["payment_methods"], ["pix", "card"])
        self.assertNotIn("created_at", response.data)
        self.assertNotIn("id", response.data)

    def test_public_endpoint_stable_shape_without_a_row(self) -> None:
        bare = Store.objects.create(name="Sem Config", slug="sem-config-cc")
        response: Any = APIClient().get(public_url(bare.slug))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["orders_enabled"])
        self.assertEqual(response.data["minimum_order_value"], "0.00")
        # A public read must never lazily create a row.
        self.assertFalse(
            StoreCommerceSettings.objects.filter(store=bare).exists()
        )

    def test_inactive_store_is_not_found(self) -> None:
        self.store.is_active = False
        self.store.save(update_fields=["is_active"])
        response: Any = APIClient().get(public_url(self.store.slug))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
