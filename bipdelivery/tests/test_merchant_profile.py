"""COMMERCE P1 -- Merchant Profile.

Covers the vertical slice: model invariants, the
`/api/v1/store/current/merchant-profile/` endpoint (GET/PATCH), RBAC,
multi-tenant isolation, field validation/normalization, the storefront-safe
public projection, and that nothing about the pre-existing Store /
StoreSettings / checkout contracts changed.

Tenant resolution for an authenticated request comes from the JWT's
`store_id` claim, simulated here with
`force_authenticate(user, token={"store_id": ...})` -- the same pattern the
rest of the suite uses.
"""
from decimal import Decimal
from typing import Any

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.test import RequestFactory, TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.admin import MerchantProfileAdminForm
from bipdelivery.api.models import (
    Category,
    MerchantProfile,
    Product,
    SaleOrder,
    Store,
    StoreMembership,
    StoreSettings,
)

User = get_user_model()

PROFILE_URL = "/api/v1/store/current/merchant-profile/"

VALID_CNPJ = "11222333000181"
VALID_CPF = "39053344705"


def make_member(store: Store, *, role: str, username: str) -> Any:
    user = User.objects.create_user(username=username, password="pw-12345678")
    StoreMembership.objects.create(store=store, user=user, role=role)
    return user


def auth(client: APIClient, user: Any, store: Store) -> None:
    client.force_authenticate(user=user, token={"store_id": store.id})


def grant_admin_permissions(user: Any, *codenames: str) -> None:
    permissions = Permission.objects.filter(
        codename__in=codenames,
        content_type__app_label="api",
    )
    user.user_permissions.add(*permissions)


def merchant_profile_admin_payload(store: Store, **overrides: str) -> dict[str, str]:
    payload = {
        "store": str(store.id),
        "legal_name": "",
        "trade_name": "Loja Admin",
        "tax_id": "",
        "contact_email": "",
        "contact_phone": "",
        "postal_code": "",
        "street": "",
        "number": "",
        "complement": "",
        "district": "",
        "city": "",
        "state": "",
        "country": "BR",
        "website_url": "",
        "instagram_url": "",
        "facebook_url": "",
        "tiktok_url": "",
        "youtube_url": "",
        "_save": "Save",
    }
    payload.update(overrides)
    return payload


class MerchantProfileModelTest(TestCase):
    def test_get_for_store_is_idempotent(self) -> None:
        store = Store.get_default()

        first = MerchantProfile.get_for_store(store)
        second = MerchantProfile.get_for_store(store)

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(MerchantProfile.objects.filter(store=store).count(), 1)

    def test_blank_profile_is_not_complete(self) -> None:
        profile = MerchantProfile.get_for_store(Store.get_default())

        self.assertFalse(profile.is_complete)
        self.assertFalse(profile.has_complete_address)

    def test_fully_filled_profile_is_complete(self) -> None:
        profile = MerchantProfile.get_for_store(Store.get_default())
        profile.trade_name = "Loja Teste"
        profile.tax_id = VALID_CNPJ
        profile.contact_email = "loja@example.com"
        profile.contact_phone = "7133334444"
        profile.postal_code = "40010000"
        profile.street = "Rua A"
        profile.number = "100"
        profile.district = "Centro"
        profile.city = "Salvador"
        profile.state = "BA"
        profile.save()

        self.assertTrue(profile.has_complete_address)
        self.assertTrue(profile.is_complete)

    def test_cascade_delete_with_store(self) -> None:
        store = Store.objects.create(name="Temp", slug="temp-store")
        MerchantProfile.get_for_store(store)

        store.delete()

        self.assertFalse(MerchantProfile.objects.filter(store_id=store.id).exists())


class MerchantProfileAdminTenantScopingTest(TestCase):
    """Django admin must enforce the same tenant boundary as the dashboard API."""

    def setUp(self) -> None:
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.store_c = Store.objects.create(name="Loja C", slug="loja-c")
        self.staff_a = User.objects.create_user(
            username="admin-staff-a", password="pw-12345678", is_staff=True
        )
        StoreMembership.objects.create(
            store=self.store_a, user=self.staff_a, role=StoreMembership.ROLE_OWNER
        )
        self.staff_ab = User.objects.create_user(
            username="admin-staff-ab", password="pw-12345678", is_staff=True
        )
        StoreMembership.objects.create(
            store=self.store_a, user=self.staff_ab, role=StoreMembership.ROLE_OWNER
        )
        StoreMembership.objects.create(
            store=self.store_b, user=self.staff_ab, role=StoreMembership.ROLE_MANAGER
        )
        self.superuser = User.objects.create_superuser(
            username="admin-root",
            password="pw-12345678",
            email="root@example.com",
        )
        for user in (self.staff_a, self.staff_ab):
            grant_admin_permissions(
                user,
                "add_merchantprofile",
                "change_merchantprofile",
                "view_merchantprofile",
            )
        self.model_admin = admin.site._registry[MerchantProfile]
        self.factory = RequestFactory()

    def _admin_request(self, user: Any):
        request = self.factory.post("/admin/api/merchantprofile/add/")
        request.user = user
        return request

    def _store_field_ids_for(self, user: Any) -> list[int]:
        self.client.force_login(user)
        response = self.client.get("/admin/api/merchantprofile/add/")
        form = response.context["adminform"].form
        return list(form.fields["store"].queryset.order_by("id").values_list("id", flat=True))

    def test_staff_sees_only_membership_stores_in_store_field(self) -> None:
        self.assertEqual(self._store_field_ids_for(self.staff_a), [self.store_a.id])

    def test_staff_creates_profile_in_own_store(self) -> None:
        self.client.force_login(self.staff_a)

        response = self.client.post(
            "/admin/api/merchantprofile/add/",
            merchant_profile_admin_payload(self.store_a, trade_name="Admin A"),
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(
            MerchantProfile.objects.filter(
                store=self.store_a, trade_name="Admin A"
            ).exists()
        )

    def test_staff_cannot_create_profile_in_foreign_store_by_forged_post(self) -> None:
        self.client.force_login(self.staff_a)

        response = self.client.post(
            "/admin/api/merchantprofile/add/",
            merchant_profile_admin_payload(self.store_b, trade_name="Forged B"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            MerchantProfile.objects.filter(
                store=self.store_b, trade_name="Forged B"
            ).exists()
        )

    def test_save_model_rejects_foreign_store_even_if_form_is_bypassed(self) -> None:
        obj = MerchantProfile(store=self.store_b, trade_name="Bypass B")

        with self.assertRaises(PermissionDenied):
            self.model_admin.save_model(
                self._admin_request(self.staff_a), obj, form=None, change=False
            )

        self.assertFalse(
            MerchantProfile.objects.filter(
                store=self.store_b, trade_name="Bypass B"
            ).exists()
        )

    def test_save_model_rejects_foreign_existing_object_even_if_target_is_owned(
        self,
    ) -> None:
        profile = MerchantProfile.objects.create(
            store=self.store_b, trade_name="Foreign B"
        )
        profile.store = self.store_a

        with self.assertRaises(PermissionDenied):
            self.model_admin.save_model(
                self._admin_request(self.staff_a), profile, form=None, change=True
            )

        profile.refresh_from_db()
        self.assertEqual(profile.store_id, self.store_b.id)
        self.assertEqual(profile.trade_name, "Foreign B")

    def test_staff_cannot_move_existing_profile_to_foreign_store(self) -> None:
        profile = MerchantProfile.objects.create(
            store=self.store_a, trade_name="Original A"
        )
        self.client.force_login(self.staff_a)

        response = self.client.post(
            f"/admin/api/merchantprofile/{profile.id}/change/",
            merchant_profile_admin_payload(self.store_b, trade_name="Moved B"),
        )

        self.assertEqual(response.status_code, 200)
        profile.refresh_from_db()
        self.assertEqual(profile.store_id, self.store_a.id)
        self.assertEqual(profile.trade_name, "Original A")

    def test_member_of_two_stores_can_select_and_create_for_both(self) -> None:
        self.assertEqual(
            self._store_field_ids_for(self.staff_ab),
            [self.store_a.id, self.store_b.id],
        )
        self.client.force_login(self.staff_ab)

        response = self.client.post(
            "/admin/api/merchantprofile/add/",
            merchant_profile_admin_payload(self.store_b, trade_name="Admin B"),
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(
            MerchantProfile.objects.filter(
                store=self.store_b, trade_name="Admin B"
            ).exists()
        )

    def test_superuser_keeps_full_store_access(self) -> None:
        self.assertEqual(
            self._store_field_ids_for(self.superuser),
            [self.store_a.id, self.store_b.id, self.store_c.id],
        )
        self.client.force_login(self.superuser)

        response = self.client.post(
            "/admin/api/merchantprofile/add/",
            merchant_profile_admin_payload(self.store_c, trade_name="Root C"),
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(
            MerchantProfile.objects.filter(
                store=self.store_c, trade_name="Root C"
            ).exists()
        )

    def test_foreign_record_is_absent_from_staff_queryset(self) -> None:
        own = MerchantProfile.objects.create(store=self.store_a, trade_name="Own A")
        foreign = MerchantProfile.objects.create(
            store=self.store_b, trade_name="Foreign B"
        )
        request = self.factory.get("/admin/api/merchantprofile/")
        request.user = self.staff_a

        queryset = self.model_admin.get_queryset(request)

        self.assertIn(own, queryset)
        self.assertNotIn(foreign, queryset)


class MerchantProfileAdminInvariantTest(TestCase):
    """Admin ModelForm and API share MerchantProfile normalization/validation."""

    def setUp(self) -> None:
        self.store = Store.get_default()

    def _form(self, **overrides: str) -> MerchantProfileAdminForm:
        return MerchantProfileAdminForm(
            data=merchant_profile_admin_payload(self.store, **overrides)
        )

    def test_admin_rejects_invalid_cpf_cnpj(self) -> None:
        form = self._form(tax_id="11111111111")

        self.assertFalse(form.is_valid())
        self.assertIn("tax_id", form.errors)

    def test_admin_normalizes_masked_document(self) -> None:
        form = self._form(tax_id="11.222.333/0001-81")

        self.assertTrue(form.is_valid(), form.errors)
        profile = form.save()
        self.assertEqual(profile.tax_id, VALID_CNPJ)

    def test_admin_normalizes_or_rejects_contact_phone(self) -> None:
        ok = self._form(contact_phone="(71) 3333-4444")
        self.assertTrue(ok.is_valid(), ok.errors)
        profile = ok.save()
        self.assertEqual(profile.contact_phone, "7133334444")

        bad_store = Store.objects.create(name="Telefone ruim", slug="telefone-ruim")
        bad = MerchantProfileAdminForm(
            data=merchant_profile_admin_payload(bad_store, contact_phone="3333")
        )
        self.assertFalse(bad.is_valid())
        self.assertIn("contact_phone", bad.errors)

    def test_admin_normalizes_or_rejects_postal_code(self) -> None:
        ok = self._form(postal_code="40010-000")
        self.assertTrue(ok.is_valid(), ok.errors)
        profile = ok.save()
        self.assertEqual(profile.postal_code, "40010000")

        bad_store = Store.objects.create(name="CEP ruim", slug="cep-ruim")
        bad = MerchantProfileAdminForm(
            data=merchant_profile_admin_payload(bad_store, postal_code="123")
        )
        self.assertFalse(bad.is_valid())
        self.assertIn("postal_code", bad.errors)

    def test_admin_rejects_incompatible_social_hosts(self) -> None:
        cases = {
            "instagram_url": "https://example.com/loja",
            "facebook_url": "https://instagram.com/loja",
            "tiktok_url": "https://youtube.com/@loja",
            "youtube_url": "https://tiktok.com/@loja",
        }

        for field, url in cases.items():
            with self.subTest(field=field):
                store = Store.objects.create(
                    name=f"Host ruim {field}",
                    slug=f"host-ruim-{field.replace('_', '-')}",
                )
                form = MerchantProfileAdminForm(
                    data=merchant_profile_admin_payload(store, **{field: url})
                )
                self.assertFalse(form.is_valid())
                self.assertIn(field, form.errors)

    def test_admin_accepts_empty_optional_fields(self) -> None:
        form = self._form(
            trade_name="",
            tax_id="",
            contact_email="",
            contact_phone="",
            postal_code="",
            website_url="",
            instagram_url="",
            facebook_url="",
            tiktok_url="",
            youtube_url="",
        )

        self.assertTrue(form.is_valid(), form.errors)

    def test_valid_admin_profile_is_saved_with_normalized_fields(self) -> None:
        form = self._form(
            legal_name="ACME LTDA",
            trade_name="ACME",
            tax_id="11.222.333/0001-81",
            contact_email="loja@example.com",
            contact_phone="(71) 3333-4444",
            postal_code="40010-000",
            city="Salvador",
            state="BA",
            website_url="https://minhaloja.com.br",
            instagram_url="https://instagram.com/minhaloja",
            facebook_url="https://facebook.com/minhaloja",
            tiktok_url="https://tiktok.com/@minhaloja",
            youtube_url="https://youtube.com/@minhaloja",
        )

        self.assertTrue(form.is_valid(), form.errors)
        profile = form.save()
        self.assertEqual(profile.tax_id, VALID_CNPJ)
        self.assertEqual(profile.contact_phone, "7133334444")
        self.assertEqual(profile.postal_code, "40010000")


class MerchantProfileReadTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner-a")

    def test_requires_authentication(self) -> None:
        response: Any = APIClient().get(PROFILE_URL)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_member_reads_own_profile_with_stable_shape(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)

        response: Any = client.get(PROFILE_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for field in (
            "legal_name",
            "trade_name",
            "tax_id",
            "contact_email",
            "contact_phone",
            "postal_code",
            "street",
            "number",
            "complement",
            "district",
            "city",
            "state",
            "country",
            "website_url",
            "instagram_url",
            "facebook_url",
            "tiktok_url",
            "youtube_url",
            "is_complete",
            "has_complete_address",
        ):
            self.assertIn(field, response.data)
        self.assertEqual(response.data["country"], "BR")
        self.assertFalse(response.data["is_complete"])
        # id / store are never exposed -- no tenant linkage leaks to the client.
        self.assertNotIn("id", response.data)
        self.assertNotIn("store", response.data)
        self.assertNotIn("store_id", response.data)

    def test_get_creates_at_most_one_row(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)

        client.get(PROFILE_URL)
        client.get(PROFILE_URL)

        self.assertEqual(MerchantProfile.objects.filter(store=self.store).count(), 1)


class MerchantProfileTenantIsolationTest(TestCase):
    def setUp(self) -> None:
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.owner_a = make_member(self.store_a, role=StoreMembership.ROLE_OWNER, username="owner-a")
        self.owner_b = make_member(self.store_b, role=StoreMembership.ROLE_OWNER, username="owner-b")

        self.profile_b = MerchantProfile.get_for_store(self.store_b)
        self.profile_b.legal_name = "Razao Social B LTDA"
        self.profile_b.tax_id = VALID_CNPJ
        self.profile_b.save()

    def test_store_a_owner_cannot_read_store_b_profile(self) -> None:
        client = APIClient()
        # Stale/foreign store_id claim: owner_a is not a member of store_b.
        client.force_authenticate(user=self.owner_a, token={"store_id": self.store_b.id})

        response: Any = client.get(PROFILE_URL)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_store_a_owner_cannot_edit_store_b_profile(self) -> None:
        client = APIClient()
        client.force_authenticate(user=self.owner_a, token={"store_id": self.store_b.id})

        response: Any = client.patch(PROFILE_URL, {"legal_name": "Hijack"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.profile_b.refresh_from_db()
        self.assertEqual(self.profile_b.legal_name, "Razao Social B LTDA")

    def test_x_store_slug_header_for_foreign_store_is_ignored(self) -> None:
        client = APIClient()
        auth(client, self.owner_a, self.store_a)

        response: Any = client.get(PROFILE_URL, HTTP_X_STORE_SLUG=self.store_b.slug)

        # Header naming a store the user does not belong to is ignored; the
        # request resolves to store_a (their own), never store_b's data.
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotEqual(response.data["legal_name"], "Razao Social B LTDA")

    def test_each_store_edits_its_own_profile_independently(self) -> None:
        client_a = APIClient()
        auth(client_a, self.owner_a, self.store_a)
        client_a.patch(PROFILE_URL, {"trade_name": "Fantasia A"}, format="json")

        self.assertEqual(
            MerchantProfile.objects.get(store=self.store_a).trade_name, "Fantasia A"
        )
        self.assertEqual(
            MerchantProfile.objects.get(store=self.store_b).trade_name, ""
        )


class MerchantProfileRbacTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner")
        self.manager = make_member(self.store, role=StoreMembership.ROLE_MANAGER, username="manager")
        self.viewer = make_member(self.store, role=StoreMembership.ROLE_VIEWER, username="viewer")

    def test_owner_can_patch(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)

        response: Any = client.patch(PROFILE_URL, {"trade_name": "Loja X"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["trade_name"], "Loja X")

    def test_manager_can_patch(self) -> None:
        client = APIClient()
        auth(client, self.manager, self.store)

        response: Any = client.patch(PROFILE_URL, {"city": "Recife"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_viewer_can_read_but_not_patch(self) -> None:
        client = APIClient()
        auth(client, self.viewer, self.store)

        self.assertEqual(client.get(PROFILE_URL).status_code, status.HTTP_200_OK)

        response: Any = client.patch(PROFILE_URL, {"trade_name": "Nope"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(
            MerchantProfile.objects.filter(store=self.store, trade_name="Nope").exists()
        )


class MerchantProfilePatchSemanticsTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner")
        self.client_ = APIClient()
        auth(self.client_, self.owner, self.store)

    def test_partial_patch_preserves_omitted_fields(self) -> None:
        self.client_.patch(
            PROFILE_URL,
            {"legal_name": "ACME LTDA", "city": "Salvador", "state": "BA"},
            format="json",
        )

        response: Any = self.client_.patch(
            PROFILE_URL, {"trade_name": "ACME Store"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["legal_name"], "ACME LTDA")
        self.assertEqual(response.data["city"], "Salvador")
        self.assertEqual(response.data["state"], "BA")
        self.assertEqual(response.data["trade_name"], "ACME Store")

    def test_empty_string_clears_an_optional_field(self) -> None:
        self.client_.patch(PROFILE_URL, {"instagram_url": "https://instagram.com/acme"}, format="json")

        response: Any = self.client_.patch(PROFILE_URL, {"instagram_url": ""}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["instagram_url"], "")

    def test_empty_patch_is_a_noop(self) -> None:
        self.client_.patch(PROFILE_URL, {"legal_name": "Keep Me"}, format="json")

        response: Any = self.client_.patch(PROFILE_URL, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["legal_name"], "Keep Me")


class MerchantProfileValidationTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner")
        self.client_ = APIClient()
        auth(self.client_, self.owner, self.store)

    def _patch(self, payload: dict) -> Any:
        return self.client_.patch(PROFILE_URL, payload, format="json")

    def test_invalid_email_rejected(self) -> None:
        self.assertEqual(self._patch({"contact_email": "not-an-email"}).status_code, 400)

    def test_valid_email_accepted(self) -> None:
        response = self._patch({"contact_email": "loja@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["contact_email"], "loja@example.com")

    def test_javascript_url_scheme_rejected(self) -> None:
        response = self._patch({"website_url": "javascript:alert(1)"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("website_url", response.data)

    def test_ftp_url_scheme_rejected(self) -> None:
        self.assertEqual(self._patch({"website_url": "ftp://example.com/x"}).status_code, 400)

    def test_data_url_scheme_rejected(self) -> None:
        self.assertEqual(
            self._patch({"website_url": "data:text/html,<script>1</script>"}).status_code,
            400,
        )

    def test_valid_https_website_accepted(self) -> None:
        response = self._patch({"website_url": "https://minhaloja.com.br"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["website_url"], "https://minhaloja.com.br")

    def test_valid_social_url_accepted(self) -> None:
        response = self._patch(
            {
                "instagram_url": "https://www.instagram.com/minhaloja",
                "facebook_url": "https://facebook.com/minhaloja",
                "tiktok_url": "https://www.tiktok.com/@minhaloja",
                "youtube_url": "https://youtube.com/@minhaloja",
            }
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["instagram_url"], "https://www.instagram.com/minhaloja")

    def test_social_url_pointing_at_wrong_network_rejected(self) -> None:
        response = self._patch({"instagram_url": "https://example.com/minhaloja"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("instagram_url", response.data)

    def test_all_network_specific_social_hosts_are_checked(self) -> None:
        cases = {
            "facebook_url": "https://instagram.com/minhaloja",
            "tiktok_url": "https://youtube.com/@minhaloja",
            "youtube_url": "https://tiktok.com/@minhaloja",
        }

        for field, url in cases.items():
            with self.subTest(field=field):
                response = self._patch({field: url})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)

    def test_tax_id_cnpj_normalized_to_digits(self) -> None:
        response = self._patch({"tax_id": "11.222.333/0001-81"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tax_id"], VALID_CNPJ)

    def test_tax_id_cpf_accepted(self) -> None:
        response = self._patch({"tax_id": VALID_CPF})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tax_id"], VALID_CPF)

    def test_tax_id_bad_checksum_rejected(self) -> None:
        self.assertEqual(self._patch({"tax_id": "11111111111"}).status_code, 400)

    def test_tax_id_implausible_length_rejected(self) -> None:
        self.assertEqual(self._patch({"tax_id": "12345"}).status_code, 400)

    def test_tax_id_can_be_cleared(self) -> None:
        self._patch({"tax_id": VALID_CPF})
        response = self._patch({"tax_id": ""})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tax_id"], "")

    def test_postal_code_normalized_and_length_checked(self) -> None:
        ok = self._patch({"postal_code": "40010-000"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["postal_code"], "40010000")

        self.assertEqual(self._patch({"postal_code": "123"}).status_code, 400)

    def test_contact_phone_normalized_to_digits(self) -> None:
        response = self._patch({"contact_phone": "(71) 3333-4444"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["contact_phone"], "7133334444")

    def test_contact_phone_too_short_rejected(self) -> None:
        self.assertEqual(self._patch({"contact_phone": "3333"}).status_code, 400)

    def test_unknown_uf_rejected(self) -> None:
        self.assertEqual(self._patch({"state": "XX"}).status_code, 400)

    def test_known_uf_accepted_and_blank_allowed(self) -> None:
        self.assertEqual(self._patch({"state": "SP"}).status_code, 200)
        self.assertEqual(self._patch({"state": ""}).status_code, 200)

    def test_is_complete_flips_true_once_everything_is_filled(self) -> None:
        response = self._patch(
            {
                "trade_name": "Loja Completa",
                "tax_id": VALID_CNPJ,
                "contact_email": "loja@example.com",
                "contact_phone": "7133334444",
                "postal_code": "40010000",
                "street": "Rua A",
                "number": "100",
                "district": "Centro",
                "city": "Salvador",
                "state": "BA",
            }
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_complete"])
        self.assertTrue(response.data["has_complete_address"])


class MerchantProfilePublicProjectionTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.objects.create(name="Loja Publica", slug="loja-publica")
        profile = MerchantProfile.get_for_store(self.store)
        profile.legal_name = "Razao Social Secreta LTDA"
        profile.trade_name = "Loja Publica"
        profile.tax_id = VALID_CNPJ
        profile.contact_email = "interno@example.com"
        profile.contact_phone = "7133334444"
        profile.postal_code = "40010000"
        profile.street = "Rua Secreta"
        profile.number = "42"
        profile.district = "Centro"
        profile.city = "Salvador"
        profile.state = "BA"
        profile.website_url = "https://loja-publica.com.br"
        profile.instagram_url = "https://instagram.com/lojapublica"
        profile.save()

    def test_public_storefront_appearance_exposes_only_safe_merchant_fields(self) -> None:
        response: Any = APIClient().get(
            f"/api/v1/public/stores/{self.store.slug}/appearance/"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        merchant = response.data["merchant"]
        self.assertEqual(
            set(merchant.keys()),
            {
                "trade_name",
                "city",
                "state",
                "website_url",
                "instagram_url",
                "facebook_url",
                "tiktok_url",
                "youtube_url",
            },
        )
        self.assertEqual(merchant["trade_name"], "Loja Publica")
        self.assertEqual(merchant["instagram_url"], "https://instagram.com/lojapublica")

        serialized = str(response.data)
        self.assertNotIn("Razao Social Secreta", serialized)
        self.assertNotIn(VALID_CNPJ, serialized)
        self.assertNotIn("interno@example.com", serialized)
        self.assertNotIn("Rua Secreta", serialized)
        self.assertNotIn("40010000", serialized)

    def test_public_endpoint_stable_shape_for_store_without_profile(self) -> None:
        bare_store = Store.objects.create(name="Sem Perfil", slug="sem-perfil")

        response: Any = APIClient().get(
            f"/api/v1/public/stores/{bare_store.slug}/appearance/"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["merchant"]["trade_name"], "")
        # A public read must not lazily create a row.
        self.assertFalse(MerchantProfile.objects.filter(store=bare_store).exists())


@override_settings(WHATSAPP_ORDER_PHONE="5571999999999")
class MerchantProfileBackwardCompatibilityTest(TestCase):
    """Nothing about the pre-existing Store / StoreSettings / checkout
    contracts may change because MerchantProfile was added."""

    def setUp(self) -> None:
        cache.clear()
        self.store = Store.get_default()
        self.store.whatsapp_phone = "5571988887777"
        self.store.save(update_fields=["whatsapp_phone"])
        self.owner = make_member(self.store, role=StoreMembership.ROLE_OWNER, username="owner")
        self.category = Category.objects.create(name="Roupas", slug="roupas", store=self.store)
        self.product = Product.objects.create(
            name="Camiseta",
            sku="CAM-001",
            price=Decimal("59.90"),
            stock_quantity=10,
            category=self.category,
            store=self.store,
        )

    def test_store_current_endpoint_unchanged(self) -> None:
        response: Any = APIClient().get("/api/v1/store/current/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("merchant_profile", response.data)
        self.assertIn("whatsapp_phone", response.data)

    def test_legacy_store_settings_endpoint_still_reads_store_whatsapp(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)

        response: Any = client.get("/api/v1/store-settings/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "5571988887777")
        # Still no real StoreSettings rows -- the snapshot is transient.
        self.assertEqual(StoreSettings.objects.count(), 0)

    def test_store_without_merchant_profile_still_checks_out(self) -> None:
        self.assertFalse(MerchantProfile.objects.filter(store=self.store).exists())

        response: Any = APIClient().post(
            "/api/v1/checkout/whatsapp/",
            {
                "items": [{"product_id": self.product.id, "quantity": 1}],
                "customer": {
                    "delivery_method": "pickup",
                    "payment_method": "pix",
                    "full_name": "Cliente Teste",
                    "phone": "71999999999",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(SaleOrder.objects.filter(store=self.store).exists())

    def test_editing_merchant_profile_does_not_touch_store_whatsapp(self) -> None:
        client = APIClient()
        auth(client, self.owner, self.store)

        client.patch(
            PROFILE_URL,
            {"contact_phone": "7100000000", "trade_name": "Nova Fantasia"},
            format="json",
        )

        self.store.refresh_from_db()
        self.assertEqual(self.store.whatsapp_phone, "5571988887777")
