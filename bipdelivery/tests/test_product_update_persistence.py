"""Product update persistence: an edit saved from the dashboard must survive
a reload / a fresh GET (regression guard for the "I changed it, it looked
saved, then it came back on reload" bug).

Every test drives the exact multipart PATCH the dashboard form sends
(scalars, `low_stock_threshold`, `existing_images[*]`, `variants_payload`)
against /api/v1/products/{id}/ and then proves persistence three ways at
once:
  1. the PATCH response body,
  2. the row read fresh from the DB,
  3. a brand-new GET /api/v1/products/{id}/.

Also covers: clearing a free-text field to '' (the frontend fix in
useProducts._preparePayload now sends description/size as explicit ''),
cross-tenant isolation on update, and the one known silent no-op
(`is_available`, xfail -- documented for separate authorization).
"""
import json
from decimal import Decimal

import pytest
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import (
    Category,
    Product,
    ProductVariant,
    Store,
    StoreMembership,
)

# a 1x1 transparent PNG
PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05"
    b"\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class ProductUpdatePersistenceReproTest(TestCase):
    def setUp(self) -> None:
        self.store = Store.get_default()
        self.category = Category.objects.create(name="Cat", store=self.store)
        self.other_category = Category.objects.create(name="Cat 2", store=self.store)
        self.product = Product.objects.create(
            name="Nome Original",
            description="Descricao original",
            price=Decimal("10.00"),
            size="P",
            stock_quantity=5,
            is_available=True,
            category=self.category,
            store=self.store,
        )
        # A real dashboard manager: NOT is_staff (that flag is a platform-admin
        # role no self-service flow grants). Write access comes from the
        # StoreMembership role, exactly like production.
        self.user = User.objects.create_user(username="mgr", password="x")
        StoreMembership.objects.create(
            store=self.store, user=self.user, role=StoreMembership.ROLE_MANAGER
        )
        self.client = APIClient()
        self.client.force_authenticate(
            user=self.user, token={"store_id": self.store.id}
        )
        self.url = f"/api/v1/products/{self.product.id}/"

    def _get_fresh(self):
        return self.client.get(self.url)

    # ---- 1. plain scalar update, multipart (no variants) --------------------
    def test_scalar_update_multipart_persists(self):
        resp = self.client.patch(
            self.url,
            data={
                "name": "Nome NOVO",
                "description": "Descricao NOVA",
                "price": "33.50",
                "size": "GG",
                "category": self.other_category.id,
                "low_stock_threshold": "",
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)

        # (a) response body
        self.assertEqual(resp.data["name"], "Nome NOVO")
        self.assertEqual(resp.data["description"], "Descricao NOVA")
        self.assertEqual(str(resp.data["price"]), "33.50")

        # (b) DB row, read fresh
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome NOVO")
        self.assertEqual(self.product.description, "Descricao NOVA")
        self.assertEqual(self.product.price, Decimal("33.50"))
        self.assertEqual(self.product.size, "GG")
        self.assertEqual(self.product.category_id, self.other_category.id)

        # (c) brand-new GET
        got = self._get_fresh()
        self.assertEqual(got.data["name"], "Nome NOVO")
        self.assertEqual(got.data["description"], "Descricao NOVA")
        self.assertEqual(str(got.data["price"]), "33.50")

    # ---- 2. scalar update WITH a variants_payload present ------------------
    def test_scalar_update_with_variants_payload_persists(self):
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#0000FF",
            stock_quantity=3,
            is_active=True,
            position=0,
        )
        # Frontend always re-sends the full variants list on every edit of a
        # product that has variants.
        variants_payload = json.dumps(
            [
                {
                    "id": variant.id,
                    "name": "Azul",
                    "color_hex": "#0000FF",
                    "price": None,
                    "stock_quantity": 3,
                    "is_active": True,
                    "position": 0,
                }
            ]
        )
        resp = self.client.patch(
            self.url,
            data={
                "name": "Nome COM VARIANTE",
                "description": "Desc com variante",
                "price": "44.00",
                "size": "M",
                "category": self.category.id,
                "low_stock_threshold": "",
                "variants_payload": variants_payload,
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)

        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome COM VARIANTE")
        self.assertEqual(self.product.description, "Desc com variante")
        self.assertEqual(self.product.price, Decimal("44.00"))

        got = self._get_fresh()
        self.assertEqual(got.data["name"], "Nome COM VARIANTE")
        self.assertEqual(str(got.data["price"]), "44.00")

    # ---- 2b. the ACTUAL frontend shape: variant-less product still sends
    #          variants_payload="[]" on every edit (_preparePayload always
    #          appends it when `variants` is in the form data, even when []).
    def test_scalar_update_with_empty_variants_payload_on_variantless_product(self):
        self.assertEqual(self.product.variants.count(), 0)
        original_stock = self.product.stock_quantity
        resp = self.client.patch(
            self.url,
            data={
                "name": "Nome SEM variante",
                "description": "d",
                "price": "77.00",
                "size": "M",
                "category": self.category.id,
                "low_stock_threshold": "",
                "variants_payload": "[]",
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome SEM variante")
        self.assertEqual(self.product.price, Decimal("77.00"))
        self.assertEqual(
            self.product.stock_quantity, original_stock,
            "empty variants_payload must not zero a variant-less product's stock",
        )
        got = self._get_fresh()
        self.assertEqual(got.data["name"], "Nome SEM variante")
        self.assertEqual(str(got.data["price"]), "77.00")

    # ---- 3. JSON PATCH (non-FormData path) --------------------------------
    def test_scalar_update_json_persists(self):
        resp = self.client.patch(
            self.url,
            data={"name": "Nome JSON", "price": "12.00"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome JSON")

        got = self._get_fresh()
        self.assertEqual(got.data["name"], "Nome JSON")

    # ---- 4. description / size cleared to empty (multipart, as the FE now
    #        sends them: an emptied free-text field -> explicit '') ---------
    def test_description_cleared_to_empty_persists(self):
        resp = self.client.patch(
            self.url, data={"description": ""}, format="multipart"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.description, "")
        self.assertEqual(self._get_fresh().data["description"], "")

    def test_size_cleared_to_empty_persists(self):
        self.assertEqual(self.product.size, "P")
        resp = self.client.patch(
            self.url, data={"size": ""}, format="multipart"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.size, "")
        self.assertEqual(self._get_fresh().data["size"], "")

    def test_description_and_size_together_via_exact_frontend_shape(self):
        """The full multipart PATCH the dashboard sends when both free-text
        fields are wiped in one save."""
        resp = self.client.patch(
            self.url,
            data={
                "name": "Produto sem texto livre",
                "description": "",
                "size": "",
                "price": "10.00",
                "category": self.category.id,
                "low_stock_threshold": "",
                "variants_payload": "[]",
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Produto sem texto livre")
        self.assertEqual(self.product.description, "")
        self.assertEqual(self.product.size, "")
        got = self._get_fresh().data
        self.assertEqual(got["description"], "")
        self.assertEqual(got["size"], "")

    # ---- 4b. size semantics: never-filled vs untouched vs explicitly cleared
    def test_size_never_filled_on_create_stays_null(self):
        """The frontend omits an empty `size` on CREATE, so a product the
        merchant never gave a size keeps NULL (JSON null), not ''."""
        resp = self.client.post(
            "/api/v1/products/",
            data={
                "name": "Sem tamanho",
                "price": "5.00",
                "stock_quantity": "1",
                "category": self.category.id,
                "low_stock_threshold": "",
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        created = Product.objects.get(id=resp.data["id"])
        self.assertIsNone(created.size)
        self.assertIsNone(resp.data["size"])

    def test_size_untouched_on_edit_is_left_alone(self):
        """A PATCH that does not carry `size` must not change it."""
        self.assertEqual(self.product.size, "P")
        resp = self.client.patch(
            self.url, data={"name": "So o nome mudou"}, format="multipart"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "So o nome mudou")
        self.assertEqual(self.product.size, "P")

    # ---- 5. toggle is_available (status) --------------------------------
    # KNOWN GAP, tracked for separate authorization (NOT touched by this
    # branch's fix): Product.save() (models.py ~L327) unconditionally does
    #   self.is_available = self.stock_quantity > 0
    # on every save, so `is_available` can never be set through the API -- the
    # PATCH returns 200 and echoes the value sent, but the DB keeps
    # stock-derived availability. Latent today: NO dashboard control writes
    # is_available (productPayload.ts strips it; no toggle in form or table).
    # strict=True on purpose: the day save() stops forcing this, the
    # assertion below starts passing and pytest fails the XPASS, forcing this
    # test to be un-marked and turned into a real persistence assertion
    # instead of silently rotting.
    @pytest.mark.xfail(
        reason="Product.save() forces is_available from stock_quantity; "
        "no UI writes it yet -- see docs / separate security-or-feature branch",
        strict=True,
    )
    def test_is_available_toggle_is_silently_ignored(self):
        resp = self.client.patch(
            self.url, data={"is_available": False}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_available)

    # ---- 6. scalar edit while re-sending the existing cover image URL ----
    #        (this is EXACTLY what the dashboard form does on every save of a
    #        product that already has an image: image=<url str> ->
    #        existing_images[0]=<url str>)
    def _make_product_with_cover(self):
        self.product.image = SimpleUploadedFile("cover.png", PNG_1x1, "image/png")
        self.product.save()
        return self.client.get(self.url).data["image"]  # absolute URL as the FE sees it

    def test_scalar_edit_keeps_cover_when_frontend_resends_local_url(self):
        cover_url = self._make_product_with_cover()
        resp = self.client.patch(
            self.url,
            data={
                "name": "Nome NOVO com imagem",
                "price": "21.00",
                "low_stock_threshold": "",
                "existing_images[0]": cover_url,
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome NOVO com imagem")
        self.assertTrue(self.product.image, "cover image was WIPED by _replace_gallery")
        got = self._get_fresh()
        self.assertEqual(got.data["name"], "Nome NOVO com imagem")
        self.assertIsNotNone(got.data["image"])

    @override_settings(MEDIA_URL="https://media.bipflow-cdn.example/")
    def test_scalar_edit_keeps_cover_when_frontend_resends_cdn_url(self):
        """Production serves image URLs from an absolute R2 custom domain.
        The FE round-trips that absolute URL back as existing_images[0]."""
        cover_url = self._make_product_with_cover()
        self.assertTrue(
            cover_url.startswith("https://media.bipflow-cdn.example/"),
            f"unexpected cover url {cover_url!r}",
        )
        resp = self.client.patch(
            self.url,
            data={
                "name": "Nome NOVO cdn",
                "price": "22.00",
                "low_stock_threshold": "",
                "existing_images[0]": cover_url,
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Nome NOVO cdn")
        self.assertTrue(
            self.product.image,
            "cover image WIPED: _resolve_existing_image failed to match the CDN URL",
        )

    # ---- 7. edit a variant's price/name via variants_payload ------------
    def test_variant_edit_persists(self):
        v = ProductVariant.objects.create(
            product=self.product, name="Azul", color_hex="#0000FF",
            price=None, stock_quantity=4, is_active=True, position=0,
        )
        payload = json.dumps([{
            "id": v.id, "name": "Azul Marinho", "color_hex": "#0000FF",
            "price": "59.90", "stock_quantity": 4, "is_active": True, "position": 0,
        }])
        resp = self.client.patch(
            self.url,
            data={"name": "P com variante editada", "price": "40.00",
                  "low_stock_threshold": "", "variants_payload": payload},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        v.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(v.name, "Azul Marinho")
        self.assertEqual(v.price, Decimal("59.90"))
        self.assertEqual(self.product.name, "P com variante editada")
        got = self._get_fresh()
        self.assertEqual(got.data["variants"][0]["name"], "Azul Marinho")
        self.assertEqual(str(got.data["variants"][0]["price"]), "59.90")


class ProductUpdateTenantIsolationTest(TestCase):
    """A dashboard user of store B must never be able to update store A's product."""

    def setUp(self) -> None:
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.cat_a = Category.objects.create(name="A", store=self.store_a)
        self.cat_b = Category.objects.create(name="B", store=self.store_b)
        self.product_a = Product.objects.create(
            name="Produto da Loja A", price=Decimal("10.00"),
            category=self.cat_a, store=self.store_a, stock_quantity=5,
        )
        # NOT is_staff on purpose: real dashboard managers are plain users whose
        # write access comes from a StoreMembership role. is_staff/superuser are
        # deliberately allowed to cross tenants (support), so testing isolation
        # with an is_staff user proves nothing.
        self.user_b = User.objects.create_user(username="ub", password="x")
        StoreMembership.objects.create(
            store=self.store_b, user=self.user_b, role=StoreMembership.ROLE_MANAGER
        )
        self.client = APIClient()
        self.client.force_authenticate(
            user=self.user_b, token={"store_id": self.store_b.id}
        )

    def test_patch_detail_of_another_stores_product_is_404_and_no_write(self):
        resp = self.client.patch(
            f"/api/v1/products/{self.product_a.id}/",
            data={"name": "HACKED", "price": "0.01"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.product_a.refresh_from_db()
        self.assertEqual(self.product_a.name, "Produto da Loja A")
        self.assertEqual(self.product_a.price, Decimal("10.00"))

    def test_patch_with_spoofed_store_slug_header_is_ignored(self):
        """Sending store A's slug in X-Store-Slug must not let user_b reach it."""
        resp = self.client.patch(
            f"/api/v1/products/{self.product_a.id}/",
            data={"name": "HACKED VIA HEADER"},
            format="json",
            HTTP_X_STORE_SLUG=self.store_a.slug,
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.product_a.refresh_from_db()
        self.assertEqual(self.product_a.name, "Produto da Loja A")

    def test_cannot_reassign_product_to_a_category_of_another_store(self):
        """user_b editing their OWN product cannot point it at store A's category."""
        my_product = Product.objects.create(
            name="Meu", price=Decimal("5.00"), category=self.cat_b,
            store=self.store_b, stock_quantity=1,
        )
        resp = self.client.patch(
            f"/api/v1/products/{my_product.id}/",
            data={"category": self.cat_a.id},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.content)
        my_product.refresh_from_db()
        self.assertEqual(my_product.category_id, self.cat_b.id)
