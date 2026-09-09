"""
Backend API Health Check Tests

Comprehensive test suite validating Django REST Framework endpoints respond correctly
including database connectivity, authentication requirements, and full CRUD operations.

Documentation:
- Ensures public read endpoints and authenticated write endpoints behave correctly
- Validates data serialization and deserialization
- Tests error conditions (404, 400, protections)
- Confirms database transactional integrity

Run tests with:
    python manage.py test tests.test_api_health -v 2
    pytest tests/test_api_health.py -v (if using pytest)
"""

import json
import os
from datetime import timedelta
from decimal import Decimal
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import django
import pytest
from django.conf import settings
from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command, CommandError
from django.test import TestCase
from django.test.utils import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

# Configure Django before importing models (required for app initialization)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bipdelivery.core.settings")
django.setup()

from bipdelivery.api.models import (  # noqa: E402
    BotConversation,
    Category,
    CustomerProfile,
    DeliveryRegion,
    Product,
    ProductVariant,
    SaleOrder,
    SaleOrderItem,
    StockMovement,
    Store,
    StoreMembership,
    StoreSettings,
)
from bipdelivery.api.views import CheckoutWhatsAppView  # noqa: E402

pytestmark = pytest.mark.django_db

TEST_TEMP_ROOT = (
    Path(__file__).resolve().parents[2] / ".codex-tmp" / "django-test-media"
)
TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)


def build_test_image(filename: str) -> SimpleUploadedFile:
    """Create a tiny valid PNG upload for multipart API tests."""
    image_buffer = BytesIO()
    Image.new("RGB", (2, 2), color=(240, 120, 160)).save(image_buffer, format="PNG")
    image_buffer.seek(0)

    return SimpleUploadedFile(
        filename,
        image_buffer.read(),
        content_type="image/png",
    )


def build_oversized_test_image(filename: str) -> SimpleUploadedFile:
    """Create a valid PNG payload whose real upload size exceeds product limits."""
    image_buffer = BytesIO()
    Image.new("RGB", (2, 2), color=(240, 120, 160)).save(image_buffer, format="PNG")
    oversized_content = image_buffer.getvalue() + (b"0" * ((2 * 1024 * 1024) + 1))

    return SimpleUploadedFile(
        filename,
        oversized_content,
        content_type="image/png",
    )


def build_test_media_root() -> str:
    """Create a writable media root for upload tests on Windows sandboxes."""
    media_root = TEST_TEMP_ROOT / f"media-{uuid4().hex}"
    media_root.mkdir(parents=True)
    return str(media_root)


class CurrentUserAPITest(TestCase):
    """Test authenticated user summary endpoint."""

    client: APIClient
    user: User

    def setUp(self) -> None:
        """Initialize test client and authenticated user data."""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="ednaldo@example.com",
            email="ednaldo@example.com",
            password="testpass123",
            first_name="Ednaldo",
            last_name="Aquino",
        )

    def test_current_user_requires_authentication(self) -> None:
        """Current user endpoint should be available only to authenticated users."""
        response: Any = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_current_user_returns_display_name(self) -> None:
        """Current user endpoint should expose a human-friendly display name."""
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "ednaldo@example.com")
        self.assertEqual(response.data["display_name"], "Ednaldo Aquino")
        self.assertFalse(response.data["can_access_dashboard"])
        self.assertFalse(response.data["can_manage_catalog"])
        self.assertFalse(response.data["can_manage_orders"])

    def test_current_user_exposes_dashboard_role_capabilities(self) -> None:
        """Current user endpoint should expose dashboard RBAC capabilities."""
        self.user.is_staff = True
        self.user.save(update_fields=["is_staff"])
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.get("/api/auth/me/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["can_access_dashboard"])
        self.assertTrue(response.data["can_manage_catalog"])
        self.assertTrue(response.data["can_manage_orders"])
        self.assertIn("staff", response.data["roles"])


class CategoryAPIHealthTest(TestCase):
    """Test Category endpoints are functioning."""

    client: APIClient
    user: User
    category: Category

    def setUp(self) -> None:
        """Initialize test client and create test data."""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testuser",
            password="testpass123",
            is_staff=True,
        )
        self.category = Category.objects.create(name="Electronics", slug="electronics")

    def test_category_list_requires_auth(self) -> None:
        """Categories list should be publicly accessible."""
        response: Any = self.client.get("/api/v1/categories/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_category_list_returns_200_authenticated(self) -> None:
        """Categories list should return paginated results when authenticated."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get("/api/v1/categories/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)
        self.assertIsInstance(response.data["results"], list)

    def test_category_list_contains_data(self) -> None:
        """Categories list should contain created category."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get("/api/v1/categories/")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "Electronics")

    def test_category_create(self) -> None:
        """Should create category via POST endpoint."""
        self.client.force_authenticate(user=self.user)
        payload = {"name": "Books", "slug": "books"}
        response: Any = self.client.post("/api/v1/categories/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Books")

    def test_category_create_subcategory(self) -> None:
        """Should create a subcategory linked to a parent category."""
        self.client.force_authenticate(user=self.user)
        payload = {"name": "Biquíni", "parent": self.category.id}
        response: Any = self.client.post("/api/v1/categories/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Biquíni")
        self.assertEqual(response.data["parent"], self.category.id)
        self.assertEqual(response.data["parent_name"], "Electronics")

    def test_category_retrieve(self) -> None:
        """Should retrieve category by ID."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get(f"/api/v1/categories/{self.category.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Electronics")

    def test_category_update(self) -> None:
        """Should update category via PUT endpoint."""
        self.client.force_authenticate(user=self.user)
        payload = {"name": "Updated Electronics"}
        response: Any = self.client.put(
            f"/api/v1/categories/{self.category.id}/", payload, format="json"  # type: ignore
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Updated Electronics")

    def test_category_delete(self) -> None:
        """Should delete category via DELETE endpoint."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.delete(f"/api/v1/categories/{self.category.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Category.objects.filter(id=self.category.id).exists())  # type: ignore

    def test_category_delete_with_subcategories_is_protected(self) -> None:
        """Deleting a parent category with subcategories should fail."""
        self.client.force_authenticate(user=self.user)
        Category.objects.create(name="Biquíni", parent=self.category)

        response: Any = self.client.delete(f"/api/v1/categories/{self.category.id}/")  # type: ignore

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Category.objects.filter(id=self.category.id).exists())  # type: ignore


class ProductAPIHealthTest(TestCase):
    """Test Product endpoints are functioning."""

    client: APIClient
    user: User
    category: Category
    product: Product

    def setUp(self) -> None:
        """Initialize test client and create test data."""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testuser",
            password="testpass123",
            is_staff=True,
        )
        self.category = Category.objects.create(name="Electronics", slug="electronics")
        self.product = Product.objects.create(
            name="Laptop",
            sku="LAP-001",
            price=Decimal("999.99"),
            stock_quantity=5,
            category=self.category,
        )

    def test_product_list_requires_auth(self) -> None:
        """Products list should be publicly accessible."""
        response: Any = self.client.get("/api/v1/products/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_product_list_returns_200_authenticated(self) -> None:
        """Products list should return paginated results when authenticated."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get("/api/v1/products/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("results", response.data)
        self.assertIsInstance(response.data["results"], list)

    def test_product_list_contains_data(self) -> None:
        """Products list should contain created product."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get("/api/v1/products/")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["name"], "Laptop")

    def test_product_includes_category_name(self) -> None:
        """Product response should include denormalized category_name."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get(f"/api/v1/products/{self.product.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["category_name"], "Electronics")

    def test_product_availability_calculated(self) -> None:
        """Product should have is_available=True when stock > 0."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get(f"/api/v1/products/{self.product.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_available"])

    def test_product_unavailable_out_of_stock(self) -> None:
        """Product should have is_available=False when stock=0."""
        self.product.stock_quantity = 0
        self.product.save()
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get(f"/api/v1/products/{self.product.id}/")  # type: ignore
        self.assertFalse(response.data["is_available"])

    def test_product_create(self) -> None:
        """Should create product via POST endpoint."""
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Desktop",
            "sku": "DES-001",
            "price": "1299.99",
            "stock_quantity": 3,
            "category": self.category.id,  # type: ignore
        }
        response: Any = self.client.post("/api/v1/products/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Desktop")
        self.assertIsNotNone(response.data["slug"])

    def test_regular_authenticated_user_cannot_create_product(self) -> None:
        """Registered non-staff users should not receive catalog write access."""
        regular_user = User.objects.create_user(
            username="regular", password="testpass123"
        )
        self.client.force_authenticate(user=regular_user)
        payload = {
            "name": "Blocked Product",
            "sku": "BLK-001",
            "price": "19.99",
            "stock_quantity": 2,
            "category": self.category.id,  # type: ignore[arg-type]
        }

        response: Any = self.client.post("/api/v1/products/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Product.objects.filter(sku="BLK-001").exists())

    def test_manager_group_user_can_create_product(self) -> None:
        """Manager group members should be able to mutate catalog resources."""
        manager_group = Group.objects.create(name="manager")
        manager_user = User.objects.create_user(
            username="manager", password="testpass123"
        )
        manager_user.groups.add(manager_group)
        self.client.force_authenticate(user=manager_user)
        payload = {
            "name": "Manager Product",
            "sku": "MGR-001",
            "price": "39.99",
            "stock_quantity": 5,
            "category": self.category.id,  # type: ignore[arg-type]
        }

        response: Any = self.client.post("/api/v1/products/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["sku"], "MGR-001")

    def test_product_create_auto_generates_slug(self) -> None:
        """Product slug should be auto-generated if not provided."""
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Phone",
            "sku": "PHN-001",
            "price": "599.99",
            "stock_quantity": 10,
            "category": self.category.id,  # type: ignore
        }
        response: Any = self.client.post("/api/v1/products/", payload, format="json")
        self.assertIn("phone", response.data["slug"])
        self.assertRegex(response.data["slug"], r"^phone-[a-f0-9]{8}$")

    def test_product_retrieve(self) -> None:
        """Should retrieve product by ID."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.get(f"/api/v1/products/{self.product.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Laptop")

    def test_product_retrieve_by_slug(self) -> None:
        """Should retrieve product detail by slug for public storefront routes."""
        response: Any = self.client.get(f"/api/v1/products/by-slug/{self.product.slug}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Laptop")
        self.assertEqual(response.data["slug"], self.product.slug)
        self.assertIn("images", response.data)

    def test_product_response_includes_color_variants(self) -> None:
        """Product payload should expose ordered color variants to the storefront."""
        ProductVariant.objects.create(
            product=self.product,
            name="Preto",
            color_hex="#000000",
            stock_quantity=7,
            position=0,
        )
        ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#3366FF",
            stock_quantity=0,
            position=1,
            is_active=False,
        )

        response: Any = self.client.get(f"/api/v1/products/by-slug/{self.product.slug}/")  # type: ignore

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [
                (
                    variant["name"],
                    variant["color_hex"],
                    variant["stock_quantity"],
                    variant["is_active"],
                )
                for variant in response.data["variants"]
            ],
            [("Preto", "#000000", 7, True), ("Azul", "#3366FF", 0, False)],
        )

    def test_product_update(self) -> None:
        """Should update product via PUT endpoint.

        stock_quantity is deliberately left out of this payload: it's no
        longer editable via the product update endpoint (see
        test_stock_movements.py) -- stock changes must go through a logged
        entrada/saida movement instead.
        """
        self.client.force_authenticate(user=self.user)
        payload = {"name": "Updated Laptop"}
        response: Any = self.client.put(
            f"/api/v1/products/{self.product.id}/", payload, format="json"  # type: ignore
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Updated Laptop")

    def test_low_stock_threshold_defaults_to_null(self) -> None:
        """Unlike stock_quantity, a product with no explicit threshold stays null
        (the dashboard's default threshold applies client-side, see
        docs/architecture/stock-movement-evolution.md Etapa 3)."""
        self.assertIsNone(self.product.low_stock_threshold)

    def test_low_stock_threshold_is_settable_on_create(self) -> None:
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Produto com limite",
                "price": "9.90",
                "category": self.category.id,  # type: ignore[arg-type]
                "low_stock_threshold": 15,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["low_stock_threshold"], 15)

    def test_low_stock_threshold_is_editable_via_patch_unlike_stock_quantity(
        self,
    ) -> None:
        """The Etapa 1 lock on stock_quantity must not spill over onto this field --
        low_stock_threshold is a preference, not an audited quantity."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"low_stock_threshold": 8},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["low_stock_threshold"], 8)
        self.product.refresh_from_db()
        self.assertEqual(self.product.low_stock_threshold, 8)

    def test_low_stock_threshold_can_be_cleared_back_to_null(self) -> None:
        self.product.low_stock_threshold = 8
        self.product.save(update_fields=["low_stock_threshold"])
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"low_stock_threshold": None},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["low_stock_threshold"])

    def test_low_stock_threshold_rejects_negative_values(self) -> None:
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"low_stock_threshold": -1},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_create_preserves_three_images_in_multipart_payload(self) -> None:
        """Create should keep cover plus two gallery images in display order."""
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Burger Triplo",
            "sku": "BRG-003",
            "price": "29.90",
            "stock_quantity": 9,
            "category": self.category.id,  # type: ignore[arg-type]
            "image": build_test_image("cover.png"),
            "uploaded_images[1]": build_test_image("gallery-1.png"),
            "uploaded_images[2]": build_test_image("gallery-2.png"),
        }

        response: Any = self.client.post(
            "/api/v1/products/", payload, format="multipart"
        )

        self.assertEqual(
            response.status_code, status.HTTP_201_CREATED, msg=response.data
        )
        self.assertEqual(len(response.data["images"]), 3)
        self.assertIn("cover", response.data["images"][0])
        self.assertIn("gallery-1", response.data["images"][1])
        self.assertIn("gallery-2", response.data["images"][2])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_create_rejects_more_than_three_indexed_images(self) -> None:
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Burger Quatro Imagens",
            "sku": "BRG-004",
            "price": "29.90",
            "stock_quantity": 9,
            "category": self.category.id,  # type: ignore[arg-type]
            "image": build_test_image("cover.png"),
            "uploaded_images[1]": build_test_image("gallery-1.png"),
            "uploaded_images[2]": build_test_image("gallery-2.png"),
            "uploaded_images[3]": build_test_image("gallery-3.png"),
        }

        response: Any = self.client.post(
            "/api/v1/products/", payload, format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Product.objects.filter(sku="BRG-004").exists())

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_create_rejects_oversized_cover_image(self) -> None:
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Burger Imagem Pesada",
            "sku": "BRG-005",
            "price": "29.90",
            "stock_quantity": 9,
            "category": self.category.id,  # type: ignore[arg-type]
            "image": build_oversized_test_image("cover.png"),
        }

        with patch("bipdelivery.api.serializers.logger") as logger_mock:
            response: Any = self.client.post(
                "/api/v1/products/", payload, format="multipart"
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Product.objects.filter(sku="BRG-005").exists())
        logger_mock.warning.assert_called_once()
        log_call = logger_mock.warning.call_args
        self.assertEqual(log_call.args[0], "product_upload.rejected")
        self.assertEqual(log_call.kwargs["extra"]["event"], "product_upload.rejected")
        self.assertEqual(log_call.kwargs["extra"]["store_id"], Store.get_default().id)
        self.assertIn(
            log_call.kwargs["extra"]["field_name"],
            {"image", "uploaded_images"},
        )
        self.assertEqual(log_call.kwargs["extra"]["upload_filename"], "cover.png")
        self.assertGreater(log_call.kwargs["extra"]["size"], 2 * 1024 * 1024)

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_create_rejects_oversized_variant_image(self) -> None:
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Camiseta Variante Pesada",
            "sku": "CAM-901",
            "price": "89.90",
            "category": self.category.id,  # type: ignore[arg-type]
            "variants_payload": json.dumps(
                [
                    {
                        "name": "Preto",
                        "color_hex": "#000000",
                        "stock_quantity": 3,
                        "position": 0,
                        "is_active": True,
                        "image_upload_index": 0,
                    }
                ]
            ),
            "variant_images[0]": build_oversized_test_image("camiseta-preta.png"),
        }

        response: Any = self.client.post(
            "/api/v1/products/", payload, format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Product.objects.filter(sku="CAM-901").exists())

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_create_syncs_color_variants_from_multipart_payload(self) -> None:
        """Dashboard multipart saves variants as JSON plus scoped image uploads."""
        self.client.force_authenticate(user=self.user)
        payload = {
            "name": "Camiseta Premium",
            "sku": "CAM-900",
            "price": "89.90",
            "stock_quantity": 4,
            "category": self.category.id,  # type: ignore[arg-type]
            "variants_payload": json.dumps(
                [
                    {
                        "name": "Preto",
                        "color_hex": "#000000",
                        "stock_quantity": 3,
                        "position": 0,
                        "is_active": True,
                        "image_upload_index": 0,
                    },
                    {
                        "name": "Azul",
                        "color_hex": "#3366FF",
                        "stock_quantity": 1,
                        "position": 1,
                        "is_active": False,
                    },
                ]
            ),
            "variant_images[0]": build_test_image("camiseta-preta.png"),
        }

        response: Any = self.client.post(
            "/api/v1/products/", payload, format="multipart"
        )

        self.assertEqual(
            response.status_code, status.HTTP_201_CREATED, msg=response.data
        )
        product = Product.objects.get(id=response.data["id"])
        variants = list(product.variants.order_by("position"))
        self.assertEqual(product.stock_quantity, 3)
        self.assertEqual(
            [
                (variant.name, variant.color_hex, variant.stock_quantity)
                for variant in variants
            ],
            [("Preto", "#000000", 3), ("Azul", "#3366FF", 1)],
        )
        self.assertTrue(
            variants[0].image.name.startswith(f"products/{product.store_id}/variants/")
        )
        self.assertIn("camiseta-preta", response.data["variants"][0]["image"])
        self.assertEqual(response.data["variants"][0]["stock_quantity"], 3)
        self.assertFalse(response.data["variants"][1]["is_active"])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_product_update_preserves_existing_absolute_image_urls(self) -> None:
        """Patch should keep all existing images when dashboard sends absolute urls."""
        self.client.force_authenticate(user=self.user)
        create_payload = {
            "name": "Pizza Premium",
            "sku": "PZA-900",
            "price": "49.90",
            "stock_quantity": 6,
            "category": self.category.id,  # type: ignore[arg-type]
            "image": build_test_image("pizza-cover.png"),
            "uploaded_images[1]": build_test_image("pizza-gallery-1.png"),
            "uploaded_images[2]": build_test_image("pizza-gallery-2.png"),
        }
        create_response: Any = self.client.post(
            "/api/v1/products/", create_payload, format="multipart"
        )
        self.assertEqual(
            create_response.status_code,
            status.HTTP_201_CREATED,
            msg=create_response.data,
        )

        product_id = create_response.data["id"]
        update_payload = {
            "name": "Pizza Premium Atualizada",
            "existing_images[0]": create_response.data["images"][0],
            "existing_images[1]": create_response.data["images"][1],
            "existing_images[2]": create_response.data["images"][2],
        }

        response: Any = self.client.patch(
            f"/api/v1/products/{product_id}/", update_payload, format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(response.data["name"], "Pizza Premium Atualizada")
        self.assertEqual(len(response.data["images"]), 3)

    def test_product_update_preserves_variant_stock_when_legacy_payload_omits_it(
        self,
    ) -> None:
        """Older clients updating variant metadata should not zero existing variant stock."""
        self.client.force_authenticate(user=self.user)
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Preto",
            color_hex="#000000",
            stock_quantity=5,
            position=0,
        )

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": [
                    {
                        "id": variant.id,
                        "name": "Preto Premium",
                        "color_hex": "#111111",
                        "position": 0,
                        "is_active": True,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        variant.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(variant.stock_quantity, 5)
        self.assertEqual(self.product.stock_quantity, 5)
        self.assertFalse(StockMovement.objects.filter(product=self.product).exists())

    def test_product_create_with_variant_stock_creates_variant_initial_movements(
        self,
    ) -> None:
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Variada",
                "sku": "CAM-100",
                "price": "89.90",
                "category": self.category.id,
                "variants_payload": [
                    {
                        "name": "Preto",
                        "color_hex": "#111111",
                        "stock_quantity": 4,
                        "position": 0,
                        "is_active": True,
                    },
                    {
                        "name": "Azul",
                        "color_hex": "#3366FF",
                        "stock_quantity": 2,
                        "position": 1,
                        "is_active": True,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(
            response.status_code, status.HTTP_201_CREATED, msg=response.data
        )
        product = Product.objects.get(id=response.data["id"])
        self.assertEqual(product.stock_quantity, 6)

        movements = StockMovement.objects.filter(product=product).order_by(
            "variant__position"
        )
        self.assertEqual(movements.count(), 2)
        self.assertFalse(movements.filter(variant__isnull=True).exists())
        self.assertEqual(
            [
                (
                    movement.variant.name,
                    movement.movement_type,
                    movement.quantity,
                    movement.previous_stock,
                    movement.new_stock,
                    movement.reason,
                    movement.performed_by,
                )
                for movement in movements
            ],
            [
                (
                    "Preto",
                    StockMovement.TYPE_ENTRADA,
                    4,
                    0,
                    4,
                    StockMovement.REASON_ENTRADA_INICIAL,
                    self.user,
                ),
                (
                    "Azul",
                    StockMovement.TYPE_ENTRADA,
                    2,
                    0,
                    2,
                    StockMovement.REASON_ENTRADA_INICIAL,
                    self.user,
                ),
            ],
        )

    def test_product_create_persists_and_serializes_a_variant_price(self) -> None:
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Precificada",
                "sku": "CAM-PR1",
                "price": "50.00",
                "category": self.category.id,
                "variants_payload": [
                    {"name": "P", "color_hex": "#111111", "stock_quantity": 3, "position": 0, "is_active": True},
                    {"name": "GG", "color_hex": "#222222", "price": "70.00", "stock_quantity": 3, "position": 1, "is_active": True},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, msg=response.data)
        by_name = {v["name"]: v for v in response.data["variants"]}
        self.assertIsNone(by_name["P"]["price"])
        self.assertEqual(by_name["P"]["effective_price"], "50.00")
        self.assertEqual(by_name["GG"]["price"], "70.00")
        self.assertEqual(by_name["GG"]["effective_price"], "70.00")

    def test_product_create_rejects_an_out_of_range_variant_price(self) -> None:
        """An oversized price must 400 through the variants_payload parser, not
        500 at quantize()/INSERT (DecimalField is max_digits=10)."""
        self.client.force_authenticate(user=self.user)

        for bad_price in ("1e27", "99999999999.99"):
            response: Any = self.client.post(
                "/api/v1/products/",
                {
                    "name": f"Produto {bad_price}",
                    "sku": f"SKU-{bad_price[:4]}",
                    "price": "50.00",
                    "category": self.category.id,
                    "variants_payload": [
                        {"name": "X", "color_hex": "#111111", "price": bad_price, "stock_quantity": 1, "position": 0, "is_active": True},
                    ],
                },
                format="json",
            )
            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, msg=(bad_price, response.data)
            )

        self.assertFalse(Product.objects.filter(name__startswith="Produto 1e27").exists())

    def test_product_create_rejects_a_negative_variant_price(self) -> None:
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Produto Negativo",
                "sku": "SKU-NEG",
                "price": "50.00",
                "category": self.category.id,
                "variants_payload": [
                    {"name": "X", "color_hex": "#111111", "price": "-1.00", "stock_quantity": 1, "position": 0, "is_active": True},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, msg=response.data)

    # --- variants_payload backward compatibility for the `price` override ---
    #
    # variants_payload is full-replace. A legacy/stale dashboard bundle (the
    # one live on origin/main before this feature) sends every variant field
    # EXCEPT `price`. The `price` key must then behave exactly like
    # `stock_quantity` already does when omitted: leave the stored value
    # alone. An explicit null/"" still clears the override; 0 is still a real
    # price. See docs/architecture/product-variant-pricing.md.

    def _variants_with_overrides(self) -> tuple[ProductVariant, ProductVariant]:
        first = ProductVariant.objects.create(
            product=self.product, name="P", color_hex="#111111",
            stock_quantity=5, position=0, price=Decimal("59.90"),
        )
        second = ProductVariant.objects.create(
            product=self.product, name="M", color_hex="#222222",
            stock_quantity=5, position=1, price=Decimal("69.90"),
        )
        return first, second

    @staticmethod
    def _legacy_variant_entry(variant: ProductVariant) -> dict:
        """Exact shape origin/main's frontend `_preparePayload` builds -- no
        `price` key at all."""
        return {
            "id": variant.id,
            "name": variant.name,
            "color_hex": variant.color_hex,
            "stock_quantity": variant.stock_quantity,
            "position": variant.position,
            "is_active": variant.is_active,
        }

    def test_variant_update_without_price_key_preserves_existing_overrides(self) -> None:
        """BLOCKING regression: a legacy payload that omits `price` must NOT
        wipe per-variant overrides."""
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": [
                    self._legacy_variant_entry(first),
                    self._legacy_variant_entry(second),
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.price, Decimal("59.90"))
        self.assertEqual(second.price, Decimal("69.90"))

    def test_variant_update_explicit_null_price_clears_the_override(self) -> None:
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()
        entry = self._legacy_variant_entry(first)
        entry["price"] = None

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"variants_payload": [entry, self._legacy_variant_entry(second)]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.price)
        self.assertEqual(second.price, Decimal("69.90"))

    def test_variant_update_empty_string_price_clears_the_override(self) -> None:
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()
        entry = self._legacy_variant_entry(first)
        entry["price"] = ""

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"variants_payload": [entry, self._legacy_variant_entry(second)]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        first.refresh_from_db()
        self.assertIsNone(first.price)

    def test_variant_update_zero_price_persists_a_real_zero(self) -> None:
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()
        first_entry = self._legacy_variant_entry(first)
        first_entry["price"] = 0
        second_entry = self._legacy_variant_entry(second)
        second_entry["price"] = "0.00"

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"variants_payload": [first_entry, second_entry]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.price, Decimal("0.00"))
        self.assertEqual(second.price, Decimal("0.00"))

    def test_variant_update_valid_price_override_is_persisted(self) -> None:
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()
        entry = self._legacy_variant_entry(first)
        entry["price"] = "79.90"

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"variants_payload": [entry, self._legacy_variant_entry(second)]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        first.refresh_from_db()
        self.assertEqual(first.price, Decimal("79.90"))

    def test_variant_update_negative_price_is_rejected_and_leaves_the_override(self) -> None:
        self.client.force_authenticate(user=self.user)
        first, second = self._variants_with_overrides()
        entry = self._legacy_variant_entry(first)
        entry["price"] = "-5.00"

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {"variants_payload": [entry, self._legacy_variant_entry(second)]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, msg=response.data)
        first.refresh_from_db()
        self.assertEqual(first.price, Decimal("59.90"))

    def test_variant_create_without_price_key_yields_null(self) -> None:
        """A brand-new variant with no `price` key must land as NULL (inherit),
        not error -- the sentinel only means 'preserve' for an existing row."""
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Produto Sem Preco De Variante",
                "sku": "SKU-NOVP",
                "price": "50.00",
                "category": self.category.id,
                "variants_payload": [
                    {"name": "U", "color_hex": "#111111", "stock_quantity": 2, "position": 0, "is_active": True},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, msg=response.data)
        created = Product.objects.get(sku="SKU-NOVP")
        self.assertIsNone(created.variants.get().price)

    def test_product_update_variant_stock_creates_adjustment_movement(self) -> None:
        self.client.force_authenticate(user=self.user)
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Preto",
            color_hex="#000000",
            stock_quantity=5,
            position=0,
        )

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": [
                    {
                        "id": variant.id,
                        "name": "Preto",
                        "color_hex": "#000000",
                        "stock_quantity": 8,
                        "position": 0,
                        "is_active": True,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        variant.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(variant.stock_quantity, 8)
        self.assertEqual(self.product.stock_quantity, 8)

        movement = StockMovement.objects.get(product=self.product)
        self.assertEqual(movement.variant_id, variant.id)
        self.assertEqual(movement.movement_type, StockMovement.TYPE_ENTRADA)
        self.assertEqual(movement.quantity, 3)
        self.assertEqual(movement.previous_stock, 5)
        self.assertEqual(movement.new_stock, 8)
        self.assertEqual(movement.reason, StockMovement.REASON_AJUSTE_INVENTARIO)
        self.assertEqual(movement.source, StockMovement.SOURCE_MANUAL)
        self.assertEqual(movement.performed_by, self.user)

    def test_product_update_variant_stock_decrease_creates_saida_movement(self) -> None:
        self.client.force_authenticate(user=self.user)
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Preto",
            color_hex="#000000",
            stock_quantity=5,
            position=0,
        )

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": [
                    {
                        "id": variant.id,
                        "name": "Preto",
                        "color_hex": "#000000",
                        "stock_quantity": 2,
                        "position": 0,
                        "is_active": True,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        movement = StockMovement.objects.get(product=self.product)
        self.assertEqual(movement.variant_id, variant.id)
        self.assertEqual(movement.movement_type, StockMovement.TYPE_SAIDA)
        self.assertEqual(movement.quantity, 3)
        self.assertEqual(movement.previous_stock, 5)
        self.assertEqual(movement.new_stock, 2)
        self.assertEqual(movement.reason, StockMovement.REASON_AJUSTE_INVENTARIO)

    def test_product_delete(self) -> None:
        """Should delete product via DELETE endpoint."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.delete(f"/api/v1/products/{self.product.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Product.objects.filter(id=self.product.id).exists())  # type: ignore

    def test_product_delete_with_category_protect(self) -> None:
        """Deleting category with products should fail (PROTECT)."""
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.delete(f"/api/v1/categories/{self.category.id}/")  # type: ignore
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Category.objects.filter(id=self.category.id).exists())  # type: ignore


class ProductVariantImageAPITest(TestCase):
    """Ciclo 9: the storefront kept showing a solid color instead of the
    uploaded variant image. The backend was never actually the problem --
    these tests pin down the full upload -> persist -> public-read contract
    so a future regression here is caught before it reaches the frontend."""

    client: APIClient
    user: User
    category: Category
    product: Product

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="variant_image_user", password="testpass123", is_staff=True,
        )
        self.category = Category.objects.create(name="Camisetas", slug="camisetas")
        self.product = Product.objects.create(
            name="Camiseta Premium",
            sku="CAM-IMG-001",
            price=Decimal("89.90"),
            stock_quantity=4,
            category=self.category,
        )

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_creating_a_variant_with_an_image_persists_and_returns_it(self) -> None:
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Colorida",
                "sku": "CAM-IMG-002",
                "price": "89.90",
                "category": self.category.id,
                "variants_payload": json.dumps(
                    [
                        {
                            "name": "Vermelho",
                            "color_hex": "#CC0000",
                            "stock_quantity": 3,
                            "position": 0,
                            "is_active": True,
                            "image_upload_index": 0,
                        }
                    ]
                ),
                "variant_images[0]": build_test_image("vermelho.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, msg=response.data)
        variant = ProductVariant.objects.get(product_id=response.data["id"])
        self.assertTrue(bool(variant.image))

        api_variant = response.data["variants"][0]
        self.assertIsNotNone(api_variant["image"])
        self.assertTrue(api_variant["image"].startswith("http"))
        self.assertIn("vermelho", api_variant["image"])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_a_variant_created_without_an_image_reports_none(self) -> None:
        self.client.force_authenticate(user=self.user)
        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Sem Imagem",
                "sku": "CAM-IMG-003",
                "price": "89.90",
                "category": self.category.id,
                "variants_payload": json.dumps(
                    [
                        {
                            "name": "Preto",
                            "color_hex": "#000000",
                            "stock_quantity": 3,
                            "position": 0,
                            "is_active": True,
                        }
                    ]
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, msg=response.data)
        self.assertIsNone(response.data["variants"][0]["image"])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_replacing_a_variants_image_updates_the_stored_file_and_the_public_response(self) -> None:
        self.client.force_authenticate(user=self.user)
        variant = ProductVariant.objects.create(
            product=self.product, name="Azul", color_hex="#3366FF",
            stock_quantity=3, position=0,
            image=build_test_image("azul-original.png"),
        )
        original_image_name = variant.image.name

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": json.dumps(
                    [
                        {
                            "id": variant.id,
                            "name": "Azul",
                            "color_hex": "#3366FF",
                            "stock_quantity": 3,
                            "position": 0,
                            "is_active": True,
                            "image_upload_index": 0,
                        }
                    ]
                ),
                "variant_images[0]": build_test_image("azul-novo.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        variant.refresh_from_db()
        self.assertNotEqual(variant.image.name, original_image_name)
        self.assertIn("azul-novo", variant.image.name)

        api_variant = next(v for v in response.data["variants"] if v["id"] == variant.id)
        self.assertIn("azul-novo", api_variant["image"])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_removing_a_variants_image_clears_it_and_keeps_the_rest_of_the_variant(self) -> None:
        self.client.force_authenticate(user=self.user)
        variant = ProductVariant.objects.create(
            product=self.product, name="Verde", color_hex="#00AA00",
            stock_quantity=6, position=0,
            image=build_test_image("verde.png"),
        )

        response: Any = self.client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": json.dumps(
                    [
                        {
                            "id": variant.id,
                            "name": "Verde",
                            "color_hex": "#00AA00",
                            "stock_quantity": 6,
                            "position": 0,
                            "is_active": True,
                            "image": None,
                        }
                    ]
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        variant.refresh_from_db()
        self.assertFalse(bool(variant.image))
        self.assertEqual(variant.name, "Verde")
        self.assertEqual(variant.stock_quantity, 6)

        api_variant = next(v for v in response.data["variants"] if v["id"] == variant.id)
        self.assertIsNone(api_variant["image"])

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_a_variant_image_survives_a_fresh_query_after_saving(self) -> None:
        self.client.force_authenticate(user=self.user)
        create_response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Persistente",
                "sku": "CAM-IMG-004",
                "price": "89.90",
                "category": self.category.id,
                "variants_payload": json.dumps(
                    [
                        {
                            "name": "Roxo",
                            "color_hex": "#8800CC",
                            "stock_quantity": 2,
                            "position": 0,
                            "is_active": True,
                            "image_upload_index": 0,
                        }
                    ]
                ),
                "variant_images[0]": build_test_image("roxo.png"),
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED, msg=create_response.data)
        product_id = create_response.data["id"]
        original_image_url = create_response.data["variants"][0]["image"]

        # A brand-new, unauthenticated GET -- the public storefront path --
        # must still resolve the same persisted image.
        fresh_client = APIClient()
        fetch_response: Any = fresh_client.get(f"/api/v1/products/{product_id}/")

        self.assertEqual(fetch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(fetch_response.data["variants"][0]["image"], original_image_url)

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_an_invalid_variant_image_upload_is_rejected_and_leaves_other_fields_untouched(self) -> None:
        self.client.force_authenticate(user=self.user)
        not_an_image = SimpleUploadedFile(
            "not-an-image.txt", b"this is not image data", content_type="text/plain",
        )

        response: Any = self.client.post(
            "/api/v1/products/",
            {
                "name": "Camiseta Arquivo Invalido",
                "sku": "CAM-IMG-005",
                "price": "89.90",
                "category": self.category.id,
                "variants_payload": json.dumps(
                    [
                        {
                            "name": "Preto",
                            "color_hex": "#000000",
                            "stock_quantity": 3,
                            "position": 0,
                            "is_active": True,
                            "image_upload_index": 0,
                        }
                    ]
                ),
                "variant_images[0]": not_an_image,
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Product.objects.filter(sku="CAM-IMG-005").exists())

    @override_settings(MEDIA_ROOT=build_test_media_root())
    def test_cannot_attach_an_image_to_another_stores_variant(self) -> None:
        other_store = Store.objects.create(name="Loja B", slug="loja-b-variant-image")
        other_category = Category.objects.create(name="Categoria B", store=other_store, slug="categoria-b-img")
        other_product = Product.objects.create(
            name="Produto Loja B", price=Decimal("50.00"),
            category=other_category, store=other_store,
        )
        other_variant = ProductVariant.objects.create(
            product=other_product, name="Unica", color_hex="#111111",
            stock_quantity=1, position=0,
        )

        other_user = User.objects.create_user(
            username="variant_image_user_b", password="testpass123", is_staff=True,
        )
        StoreMembership.objects.create(store=other_store, user=other_user, role=StoreMembership.ROLE_MANAGER)
        cross_tenant_client = APIClient()
        cross_tenant_client.force_authenticate(user=other_user, token={"store_id": other_store.id})

        # Attempting to reach the *other* tenant's product at all must 404 --
        # store scoping, not variant-specific logic, is what should stop this.
        response: Any = cross_tenant_client.patch(
            f"/api/v1/products/{self.product.id}/",
            {
                "variants_payload": json.dumps([
                    {
                        "name": "Invasao",
                        "color_hex": "#000000",
                        "stock_quantity": 1,
                        "position": 0,
                        "is_active": True,
                        "image_upload_index": 0,
                    }
                ]),
                "variant_images[0]": build_test_image("invasao.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        other_variant.refresh_from_db()
        self.assertFalse(bool(other_variant.image))


class DjangoHealthTest(TestCase):
    """Test Django framework and database connectivity."""

    def test_django_database_connected(self) -> None:
        """Database connection should be functional."""
        # Creating and retrieving from DB proves connection
        user = User.objects.create_user(username="dbtest", password="pass")
        retrieved = User.objects.get(username="dbtest")
        self.assertEqual(user.id, retrieved.id)  # type: ignore

    def test_django_migrations_applied(self) -> None:
        """All migrations should be applied (tables exist)."""
        # If migrations not applied, table queries will fail
        category_count = Category.objects.count()
        self.assertEqual(category_count, 0)  # No categories yet, but table exists

    def test_django_settings_loaded(self) -> None:
        """Django settings should be properly loaded."""
        from django.conf import settings

        self.assertIsNotNone(settings.INSTALLED_APPS)
        self.assertIn("bipdelivery.api.apps.ApiConfig", settings.INSTALLED_APPS)
        self.assertIn("rest_framework", settings.INSTALLED_APPS)

    def test_drf_authentication_configured(self) -> None:
        """DRF should have JWT authentication configured."""
        from django.conf import settings

        rest_framework_config = settings.REST_FRAMEWORK
        self.assertIn("DEFAULT_AUTHENTICATION_CLASSES", rest_framework_config)
        auth_classes = rest_framework_config["DEFAULT_AUTHENTICATION_CLASSES"]
        self.assertTrue(any("JWT" in cls for cls in auth_classes))


class DashboardRoleSeedCommandTest(TestCase):
    """Test reproducible dashboard RBAC bootstrapping."""

    def test_seed_dashboard_roles_creates_expected_groups(self) -> None:
        """Management command should create the canonical dashboard groups."""
        call_command("seed_dashboard_roles", stdout=StringIO())

        self.assertTrue(Group.objects.filter(name="admin").exists())
        self.assertTrue(Group.objects.filter(name="manager").exists())
        self.assertTrue(Group.objects.filter(name="viewer").exists())

    def test_seed_dashboard_roles_can_create_staff_admin_user(self) -> None:
        """Management command should provision the Cypress-compatible admin user."""
        call_command(
            "seed_dashboard_roles",
            email="admin@example.com",
            password="admin123",
            role="admin",
            staff=True,
            stdout=StringIO(),
        )

        user = User.objects.get(email="admin@example.com")
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.check_password("admin123"))
        self.assertTrue(user.groups.filter(name="admin").exists())

    def test_seed_dashboard_roles_reads_password_from_env_when_flag_omitted(
        self,
    ) -> None:
        """DJANGO_BOOTSTRAP_ADMIN_PASSWORD must work without --password on argv --
        see docker/backend-entrypoint.sh's seed_admin_user(), which deliberately
        omits --password so the plaintext value never appears in the container's
        process list."""
        with patch.dict(
            os.environ, {"DJANGO_BOOTSTRAP_ADMIN_PASSWORD": "env-only-pass123"}
        ):
            call_command(
                "seed_dashboard_roles",
                email="envpass@example.com",
                role="admin",
                staff=True,
                stdout=StringIO(),
            )

        user = User.objects.get(email="envpass@example.com")
        self.assertTrue(user.check_password("env-only-pass123"))

    def test_seed_dashboard_roles_prefers_explicit_password_flag_over_env(self) -> None:
        with patch.dict(os.environ, {"DJANGO_BOOTSTRAP_ADMIN_PASSWORD": "env-pass123"}):
            call_command(
                "seed_dashboard_roles",
                email="flagpass@example.com",
                password="flag-pass123",
                role="admin",
                staff=True,
                stdout=StringIO(),
            )

        user = User.objects.get(email="flagpass@example.com")
        self.assertTrue(user.check_password("flag-pass123"))
        self.assertFalse(user.check_password("env-pass123"))


class StoreSettingsAPITest(TestCase):
    """Test dashboard-owned store settings endpoint."""

    client: APIClient
    user: User

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="settingsuser",
            password="testpass123",
            is_staff=True,
        )

    def test_store_settings_requires_authentication(self) -> None:
        """Store settings should be private to dashboard users."""
        response: Any = self.client.get("/api/v1/store-settings/")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_public_store_settings_exposes_only_catalog_contact(self) -> None:
        """Public catalog should read the configured WhatsApp without private metadata."""
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571999999999"
        )

        response: Any = self.client.get("/api/v1/store-settings/public/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "5571999999999")
        self.assertTrue(response.data["is_whatsapp_configured"])
        self.assertNotIn("id", response.data)
        self.assertNotIn("created_at", response.data)
        self.assertNotIn("updated_at", response.data)

    def test_public_store_settings_reads_store_level_whatsapp(self) -> None:
        """Public catalog contact must match the store used by checkout."""
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5588999999999"
        )

        response: Any = self.client.get("/api/v1/store-settings/public/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "5588999999999")
        self.assertTrue(response.data["is_whatsapp_configured"])

    def test_public_store_settings_does_not_create_empty_settings_row(self) -> None:
        """Anonymous catalog reads should not mutate settings storage."""
        response: Any = self.client.get("/api/v1/store-settings/public/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "")
        self.assertFalse(response.data["is_whatsapp_configured"])

    def test_public_store_settings_never_falls_back_to_another_store_phone(
        self,
    ) -> None:
        """A blank Store B must not inherit Store A's WhatsApp from legacy settings."""
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571000000000"
        )
        store_b = Store.objects.create(name="Loja B", slug="loja-b", whatsapp_phone="")

        response: Any = self.client.get(
            "/api/v1/store-settings/public/",
            HTTP_X_STORE_SLUG=store_b.slug,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "")
        self.assertFalse(response.data["is_whatsapp_configured"])

    def test_public_store_settings_ignores_legacy_singleton_for_non_default_store(
        self,
    ) -> None:
        """The legacy singleton cannot become Store B's public WhatsApp fallback."""
        StoreSettings.objects.create(whatsapp_phone="5571000000000")
        store_b = Store.objects.create(name="Loja B", slug="loja-b", whatsapp_phone="")

        response: Any = self.client.get(
            "/api/v1/store-settings/public/",
            HTTP_X_STORE_SLUG=store_b.slug,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "")
        self.assertFalse(response.data["is_whatsapp_configured"])

    def test_public_store_settings_resolves_the_requested_store_phone(self) -> None:
        """Public Store B settings should return B's contact, never the default store's."""
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571000000000"
        )
        store_b = Store.objects.create(
            name="Loja B",
            slug="loja-b",
            whatsapp_phone="5572000000000",
        )

        response: Any = self.client.get(
            "/api/v1/store-settings/public/",
            HTTP_X_STORE_SLUG=store_b.slug,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone_digits"], "5572000000000")
        self.assertTrue(response.data["is_whatsapp_configured"])

    def test_dashboard_user_can_update_store_whatsapp(self) -> None:
        """Dashboard writers should be able to persist the store WhatsApp number."""
        self.client.force_authenticate(user=self.user)

        response: Any = self.client.patch(
            "/api/v1/store-settings/",
            {"whatsapp_phone": "+55 (71) 99999-9999"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(response.data["whatsapp_phone"], "5571999999999")
        self.assertEqual(response.data["whatsapp_phone_digits"], "5571999999999")
        self.assertTrue(response.data["is_whatsapp_configured"])
        self.assertEqual(Store.get_default().whatsapp_phone, "5571999999999")
        self.assertEqual(StoreSettings.objects.count(), 0)

    def test_dashboard_store_settings_reflects_store_level_whatsapp(self) -> None:
        """Dashboard settings should not show stale blank data after store migration."""
        self.client.force_authenticate(user=self.user)
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571888888888"
        )

        response: Any = self.client.get("/api/v1/store-settings/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone"], "5571888888888")
        self.assertEqual(response.data["whatsapp_phone_digits"], "5571888888888")
        self.assertTrue(response.data["is_whatsapp_configured"])

    def test_dashboard_store_settings_are_scoped_to_authenticated_store(self) -> None:
        """A manager of Store B must never see Store A's dashboard settings value."""
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571000000000"
        )
        store_b = Store.objects.create(
            name="Loja B",
            slug="loja-b",
            whatsapp_phone="5572000000000",
        )
        self.client.force_authenticate(user=self.user, token={"store_id": store_b.id})

        response: Any = self.client.get("/api/v1/store-settings/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone"], "5572000000000")
        self.assertEqual(response.data["whatsapp_phone_digits"], "5572000000000")

    def test_dashboard_store_settings_update_only_current_store(self) -> None:
        """Patching Store B settings must not overwrite Store A's WhatsApp."""
        store_a = Store.get_default()
        Store.objects.filter(id=store_a.id).update(whatsapp_phone="5571000000000")
        store_b = Store.objects.create(name="Loja B", slug="loja-b")
        self.client.force_authenticate(user=self.user, token={"store_id": store_b.id})

        response: Any = self.client.patch(
            "/api/v1/store-settings/",
            {"whatsapp_phone": "+55 (72) 99999-0000"},
            format="json",
        )

        store_a.refresh_from_db()
        store_b.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["whatsapp_phone"], "5572999990000")
        self.assertEqual(store_a.whatsapp_phone, "5571000000000")
        self.assertEqual(store_b.whatsapp_phone, "5572999990000")

    def test_regular_user_cannot_update_store_settings(self) -> None:
        """Regular authenticated users should not mutate operational settings."""
        regular_user = User.objects.create_user(
            username="regularsettings", password="testpass123"
        )
        self.client.force_authenticate(user=regular_user)

        response: Any = self.client.patch(
            "/api/v1/store-settings/",
            {"whatsapp_phone": "5571999999999"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class GoLiveReadinessCommandTest(TestCase):
    """Validate the executable production readiness checklist."""

    go_live_settings = {
        "DEBUG": False,
        "ALLOWED_HOSTS": ["shop.example.com"],
        "CSRF_TRUSTED_ORIGINS": ["https://shop.example.com"],
        "CORS_ALLOWED_ORIGINS": ["https://shop.example.com"],
        "IS_PRODUCTION": False,
        "WHATSAPP_ORDER_PHONE": "",
    }

    @override_settings(**go_live_settings)
    def test_go_live_readiness_passes_with_operational_setup(self) -> None:
        """Readiness command should pass when the storefront can receive orders."""
        User.objects.create_user(
            username="operator@example.com",
            email="operator@example.com",
            password="testpass123",
            is_staff=True,
        )
        category = Category.objects.create(name="Prontos", slug="prontos")
        Product.objects.create(
            name="Produto pronto",
            sku="READY-001",
            price=Decimal("19.90"),
            stock_quantity=5,
            category=category,
        )
        DeliveryRegion.objects.create(
            name="Centro",
            city="Salvador",
            delivery_fee=Decimal("12.00"),
        )
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571999999999"
        )
        output = StringIO()

        call_command("check_go_live_readiness", stdout=output)

        self.assertIn("Go-live readiness checks passed.", output.getvalue())

    @override_settings(**go_live_settings)
    def test_go_live_readiness_accepts_store_level_whatsapp(self) -> None:
        """Readiness should follow the same store contact source as checkout."""
        User.objects.create_user(
            username="operator@example.com",
            email="operator@example.com",
            password="testpass123",
            is_staff=True,
        )
        category = Category.objects.create(name="Prontos", slug="prontos")
        Product.objects.create(
            name="Produto pronto",
            sku="READY-001",
            price=Decimal("19.90"),
            stock_quantity=5,
            category=category,
        )
        DeliveryRegion.objects.create(
            name="Centro",
            city="Salvador",
            delivery_fee=Decimal("12.00"),
        )
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5571999999999"
        )
        output = StringIO()

        call_command("check_go_live_readiness", stdout=output)

        self.assertIn("store_whatsapp", output.getvalue())
        self.assertIn("Go-live readiness checks passed.", output.getvalue())

    @override_settings(**go_live_settings)
    def test_go_live_readiness_fails_when_active_store_has_no_whatsapp(
        self,
    ) -> None:
        """Every active tenant needs an effective checkout phone before go-live."""
        User.objects.create_user(
            username="operator@example.com",
            email="operator@example.com",
            password="testpass123",
            is_staff=True,
        )
        default_store = Store.get_default()
        default_store.whatsapp_phone = "5571999999999"
        default_store.save(update_fields=["whatsapp_phone"])
        category = Category.objects.create(
            name="Prontos", slug="prontos", store=default_store
        )
        Product.objects.create(
            name="Produto pronto",
            sku="READY-001",
            price=Decimal("19.90"),
            stock_quantity=5,
            category=category,
            store=default_store,
        )
        DeliveryRegion.objects.create(
            name="Centro",
            city="Salvador",
            delivery_fee=Decimal("12.00"),
            store=default_store,
        )
        Store.objects.create(name="Loja sem WhatsApp", slug="loja-sem-whatsapp")
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command("check_go_live_readiness", stdout=output)

        self.assertIn("store_whatsapp", output.getvalue())
        self.assertIn("loja-sem-whatsapp", output.getvalue())

    @override_settings(**go_live_settings)
    def test_go_live_readiness_fails_when_active_store_has_no_sellable_catalog(
        self,
    ) -> None:
        """Catalog readiness must be checked per active tenant, not globally."""
        User.objects.create_user(
            username="operator@example.com",
            email="operator@example.com",
            password="testpass123",
            is_staff=True,
        )
        default_store = Store.get_default()
        default_store.whatsapp_phone = "5571999999999"
        default_store.save(update_fields=["whatsapp_phone"])
        category = Category.objects.create(
            name="Prontos", slug="prontos", store=default_store
        )
        Product.objects.create(
            name="Produto pronto",
            sku="READY-001",
            price=Decimal("19.90"),
            stock_quantity=5,
            category=category,
            store=default_store,
        )
        DeliveryRegion.objects.create(
            name="Centro",
            city="Salvador",
            delivery_fee=Decimal("12.00"),
            store=default_store,
        )
        Store.objects.create(
            name="Loja sem Catalogo",
            slug="loja-sem-catalogo",
            whatsapp_phone="5572888888888",
        )
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command("check_go_live_readiness", stdout=output)

        self.assertIn("catalog", output.getvalue())
        self.assertIn("loja-sem-catalogo", output.getvalue())

    @override_settings(**go_live_settings)
    def test_go_live_readiness_fails_without_catalog_and_operator(self) -> None:
        """Readiness command should fail closed when operational data is missing."""
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command("check_go_live_readiness", stdout=output)

        self.assertIn("dashboard_operator", output.getvalue())
        self.assertIn("catalog", output.getvalue())


@override_settings(WHATSAPP_ORDER_PHONE="5571999999999")
class CheckoutWhatsAppAPITest(TestCase):
    """Test the public checkout preparation endpoint."""

    client: APIClient
    category: Category
    product: Product

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.category = Category.objects.create(name="Lanches", slug="lanches")
        self.product = Product.objects.create(
            name="Combo Executivo",
            sku="CMB-001",
            price=Decimal("42.50"),
            stock_quantity=8,
            category=self.category,
        )

    def _checkout_client(
        self,
        *,
        email: str = "cliente@teste.com",
        full_name: str = "Cliente Teste",
        phone: str = "71999990000",
        address: str = "",
        neighborhood: str = "",
        city: str = "",
    ) -> APIClient:
        """Authenticated storefront customer with a CustomerProfile for the default store.

        Etapa 3 of docs/architecture/customer-profile-checkout-evolution.md:
        checkout requires this now, so every checkout test needs its own
        customer -- separate from the shared, deliberately-anonymous
        `self.client` other tests in this class rely on (e.g.
        test_sales_history_requires_authentication).
        """
        user = User.objects.create_user(
            username=email, email=email, password="testpass123"
        )
        CustomerProfile.objects.create(
            user=user,
            store=Store.get_default(),
            full_name=full_name,
            phone=phone,
            address=address,
            neighborhood=neighborhood,
            city=city,
        )
        client = APIClient()
        client.force_authenticate(user=user, token={"store_id": Store.get_default().id})
        return client

    def _build_pickup_payload(self, items: list[dict[str, int]]) -> dict[str, Any]:
        return {
            "items": items,
            "customer": {
                "delivery_method": "pickup",
                "payment_method": "card",
                "notes": "",
            },
        }

    @override_settings(WHATSAPP_ORDER_PHONE="")
    def test_checkout_without_whatsapp_configuration_rejects_without_side_effects(
        self,
    ) -> None:
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 2}]
        )

        with patch("bipdelivery.api.views.logger") as logger_mock:
            response: Any = client.post(
                "/api/v1/checkout/whatsapp/", payload, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "whatsapp_not_configured")
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertFalse(SaleOrder.objects.exists())
        self.assertFalse(StockMovement.objects.filter(product=self.product).exists())
        logger_mock.warning.assert_called_once()
        log_call = logger_mock.warning.call_args
        self.assertEqual(log_call.args[0], "checkout.rejected")
        self.assertEqual(log_call.kwargs["extra"]["event"], "checkout.rejected")
        self.assertEqual(log_call.kwargs["extra"]["code"], "whatsapp_not_configured")
        self.assertEqual(log_call.kwargs["extra"]["store_id"], Store.get_default().id)
        self.assertEqual(log_call.kwargs["extra"]["items_count"], 1)

    def test_checkout_builds_whatsapp_payload(self) -> None:
        """Checkout should return totals, note text and WhatsApp URL."""
        client = self._checkout_client(
            email="cliente@teste.com",
            address="Rua A, 123",
            neighborhood="Centro",
            city="Salvador",
        )

        with self.settings(WHATSAPP_ORDER_PHONE="5571999999999"):
            payload = {
                "items": [
                    {
                        "product_id": self.product.id,  # type: ignore[arg-type]
                        "quantity": 2,
                    }
                ],
                "customer": {
                    "delivery_method": "delivery",
                    "payment_method": "pix",
                    "notes": "Sem cebola",
                },
            }
            with patch("bipdelivery.api.views.logger") as logger_mock:
                response: Any = client.post(
                    "/api/v1/checkout/whatsapp/", payload, format="json"
                )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["subtotal"], "85.00")
        self.assertEqual(response.data["delivery_fee"], "12.00")
        self.assertEqual(response.data["total"], "97.00")
        self.assertTrue(
            response.data["whatsapp_url"].startswith(
                "https://wa.me/5571999999999?text="
            )
        )
        self.assertIn("Pedido BipFlow", response.data["message"])
        self.assertEqual(response.data["items"][0]["product_name"], "Combo Executivo")
        self.assertTrue(
            SaleOrder.objects.filter(
                order_reference=response.data["order_reference"]
            ).exists()
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 6)
        self.assertTrue(self.product.is_available)
        logger_mock.info.assert_called_once()
        log_call = logger_mock.info.call_args
        log_extra = log_call.kwargs["extra"]
        self.assertEqual(log_call.args[0], "checkout.created")
        self.assertEqual(log_extra["event"], "checkout.created")
        self.assertEqual(log_extra["store_id"], Store.get_default().id)
        self.assertEqual(log_extra["items_count"], 1)
        self.assertEqual(log_extra["delivery_method"], "delivery")
        self.assertEqual(log_extra["payment_method"], "pix")
        self.assertEqual(log_extra["subtotal"], "85.00")
        self.assertEqual(log_extra["total"], "97.00")
        self.assertNotIn("customer_name", log_extra)
        self.assertNotIn("customer_phone", log_extra)

    def test_checkout_creates_a_stock_movement_per_product(self) -> None:
        """Checkout should leave an auditable saida movement behind the decrement."""
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 2}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        sale_order = SaleOrder.objects.get(
            order_reference=response.data["order_reference"]
        )
        movements = list(
            StockMovement.objects.filter(product=self.product, sale_order=sale_order)
        )

        self.assertEqual(len(movements), 1)
        movement = movements[0]
        self.assertEqual(movement.movement_type, StockMovement.TYPE_SAIDA)
        self.assertEqual(movement.source, StockMovement.SOURCE_VENDA)
        self.assertEqual(movement.reason, StockMovement.REASON_VENDA)
        self.assertEqual(movement.quantity, 2)
        self.assertEqual(
            movement.previous_stock - movement.quantity, movement.new_stock
        )
        self.assertEqual(movement.new_stock, 6)

    def test_checkout_idempotency_returns_existing_order_without_double_stock(
        self,
    ) -> None:
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 2}]
        )
        payload["idempotency_key"] = "checkout-retry-1"

        first_response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )
        second_response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            second_response.data["order_reference"],
            first_response.data["order_reference"],
        )
        self.assertEqual(SaleOrder.objects.count(), 1)
        self.assertEqual(StockMovement.objects.filter(product=self.product).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 6)

    def test_checkout_idempotency_rejects_same_key_with_different_payload(
        self,
    ) -> None:
        client = self._checkout_client()
        first_payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 1}]
        )
        first_payload["idempotency_key"] = "checkout-conflict-1"
        second_payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 2}]
        )
        second_payload["idempotency_key"] = "checkout-conflict-1"

        first_response: Any = client.post(
            "/api/v1/checkout/whatsapp/", first_payload, format="json"
        )
        second_response: Any = client.post(
            "/api/v1/checkout/whatsapp/", second_payload, format="json"
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second_response.data["code"], "idempotency_key_conflict")
        self.assertEqual(SaleOrder.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 7)

    def test_checkout_links_a_bot_conversation_to_the_resulting_order(self) -> None:
        """A bot_session_id on checkout should mark that conversation as converted."""
        client = self._checkout_client()
        bot_response: Any = self.client.post(
            "/api/v1/bot/messages/", {"message": "Oi"}, format="json"
        )
        session_id = bot_response.data["session_id"]

        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 1}]
        )
        payload["bot_session_id"] = session_id

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        conversation = BotConversation.objects.get(session_id=session_id)
        self.assertIsNotNone(conversation.sale_order)
        self.assertEqual(
            conversation.sale_order.order_reference, response.data["order_reference"]
        )

    def test_checkout_without_a_bot_session_id_leaves_conversations_unlinked(
        self,
    ) -> None:
        """Checkout should still work for customers who never used the bot."""
        client = self._checkout_client()
        bot_response: Any = self.client.post(
            "/api/v1/bot/messages/", {"message": "Oi"}, format="json"
        )
        session_id = bot_response.data["session_id"]

        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 1}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        conversation = BotConversation.objects.get(session_id=session_id)
        self.assertIsNone(conversation.sale_order)

    def test_checkout_ignores_a_bot_session_id_from_another_store(self) -> None:
        """A session id from a different tenant must never be linked across stores."""
        client = self._checkout_client()
        other_store = Store.objects.create(
            name="Outra loja", slug="outra-loja-checkout"
        )
        bot_client = APIClient()
        bot_response: Any = bot_client.post(
            "/api/v1/bot/messages/",
            {"message": "Oi"},
            format="json",
            HTTP_X_STORE_SLUG=other_store.slug,
        )
        session_id = bot_response.data["session_id"]

        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 1}]
        )
        payload["bot_session_id"] = session_id

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        conversation = BotConversation.objects.get(session_id=session_id)
        self.assertIsNone(conversation.sale_order)

    def test_checkout_uses_dashboard_whatsapp_before_env_fallback(self) -> None:
        """Checkout should redirect to the WhatsApp configured for the store.

        Etapa 3: CheckoutWhatsAppView reads `request.store.whatsapp_phone`,
        not the StoreSettings singleton directly -- this is what
        StoreSettingsView.patch() keeps in sync today (see
        test_dashboard_user_can_update_store_whatsapp).
        """
        client = self._checkout_client()
        Store.objects.filter(id=Store.get_default().id).update(
            whatsapp_phone="5588999999999"
        )
        payload = self._build_pickup_payload(
            [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ]
        )

        with self.settings(WHATSAPP_ORDER_PHONE="5571000000000"):
            response: Any = client.post(
                "/api/v1/checkout/whatsapp/",
                payload,
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            response.data["whatsapp_url"].startswith(
                "https://wa.me/5588999999999?text="
            )
        )

    def test_checkout_marks_product_unavailable_when_stock_is_consumed(self) -> None:
        """Checkout should reserve stock and update availability when stock reaches zero."""
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 8,
                }
            ]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 0)
        self.assertFalse(self.product.is_available)

    def test_checkout_merges_duplicate_product_lines_before_reserving_stock(
        self,
    ) -> None:
        """Duplicate cart lines should become one reserved quantity for the product."""
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 2,
                },
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 3,
                },
            ]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["items"][0]["quantity"], 5)
        self.assertEqual(response.data["subtotal"], "212.50")
        self.assertEqual(len(response.data["items"]), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 3)

        order = SaleOrder.objects.get(order_reference=response.data["order_reference"])
        self.assertEqual(order.items.get().quantity, 5)

    def test_checkout_accepts_variant_id_and_persists_variant_snapshot(self) -> None:
        """Checkout should carry the selected variant into the order item snapshot."""
        client = self._checkout_client()
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#3366FF",
            stock_quantity=3,
            position=0,
        )
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "variant_id": variant.id, "quantity": 2}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(response.data["items"][0]["variant_id"], variant.id)
        self.assertEqual(response.data["items"][0]["variant_name"], "Azul")
        self.assertEqual(response.data["items"][0]["variant_color_hex"], "#3366FF")
        self.assertIn("Combo Executivo - Azul", response.data["message"])

        order = SaleOrder.objects.get(order_reference=response.data["order_reference"])
        order_item = order.items.get()
        self.assertEqual(order_item.variant_id, variant.id)
        self.assertEqual(order_item.variant_name, "Azul")
        self.assertEqual(order_item.variant_color_hex, "#3366FF")
        self.assertEqual(order_item.quantity, 2)
        variant.refresh_from_db()
        self.assertEqual(variant.stock_quantity, 1)
        movement = StockMovement.objects.get(product=self.product, sale_order=order)
        self.assertEqual(movement.variant_id, variant.id)
        self.assertEqual(movement.previous_stock, 3)
        self.assertEqual(movement.new_stock, 1)

    def test_checkout_keeps_variant_lines_separate_and_reserves_variant_stock(
        self,
    ) -> None:
        """Different variants should be separate order lines sharing product stock."""
        client = self._checkout_client()
        black = ProductVariant.objects.create(
            product=self.product,
            name="Preto",
            color_hex="#000000",
            stock_quantity=4,
            position=0,
        )
        blue = ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#3366FF",
            stock_quantity=5,
            position=1,
        )
        payload = self._build_pickup_payload(
            [
                {"product_id": self.product.id, "variant_id": black.id, "quantity": 2},
                {"product_id": self.product.id, "variant_id": blue.id, "quantity": 3},
            ]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(len(response.data["items"]), 2)
        self.assertEqual(response.data["subtotal"], "212.50")
        self.product.refresh_from_db()
        black.refresh_from_db()
        blue.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 3)
        self.assertEqual(black.stock_quantity, 2)
        self.assertEqual(blue.stock_quantity, 2)

        order = SaleOrder.objects.get(order_reference=response.data["order_reference"])
        self.assertEqual(order.items.count(), 2)
        self.assertEqual(
            sorted(order.items.values_list("variant_name", "quantity")),
            [("Azul", 3), ("Preto", 2)],
        )

    def test_checkout_rejects_inactive_variant_without_reserving_stock(self) -> None:
        """Inactive variants must not be orderable from stale cart state."""
        client = self._checkout_client()
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Esgotada",
            color_hex="#999999",
            stock_quantity=5,
            position=0,
            is_active=False,
        )
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "variant_id": variant.id, "quantity": 1}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        variant.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertEqual(variant.stock_quantity, 5)
        self.assertFalse(SaleOrder.objects.exists())

    def test_checkout_rejects_variant_stock_exceeded_without_reserving_stock(
        self,
    ) -> None:
        """A selected variant cannot sell more units than that color has."""
        client = self._checkout_client()
        variant = ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#3366FF",
            stock_quantity=1,
            position=0,
        )
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "variant_id": variant.id, "quantity": 2}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        variant.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertEqual(variant.stock_quantity, 1)
        self.assertFalse(SaleOrder.objects.exists())

    def test_checkout_requires_variant_when_product_has_active_variants(self) -> None:
        """A cart line cannot bypass variant stock once the product has active variants."""
        client = self._checkout_client()
        ProductVariant.objects.create(
            product=self.product,
            name="Azul",
            color_hex="#3366FF",
            stock_quantity=4,
            position=0,
        )
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 1}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertFalse(SaleOrder.objects.exists())

    def test_checkout_rejects_variant_from_another_product(self) -> None:
        """A variant id cannot be paired with a different product id."""
        client = self._checkout_client()
        other_product = Product.objects.create(
            name="Outro Combo",
            sku="OUT-001",
            price=Decimal("10.00"),
            stock_quantity=5,
            category=self.category,
        )
        variant = ProductVariant.objects.create(
            product=other_product,
            name="Vermelho",
            color_hex="#FF0000",
            stock_quantity=3,
            position=0,
        )
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "variant_id": variant.id, "quantity": 1}]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        other_product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertEqual(other_product.stock_quantity, 5)
        self.assertFalse(SaleOrder.objects.exists())

    def test_checkout_rejects_duplicate_lines_when_aggregated_quantity_exceeds_stock(
        self,
    ) -> None:
        """Aggregated duplicate quantities should not bypass stock validation."""
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 5,
                },
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 4,
                },
            ]
        )

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)
        self.assertFalse(SaleOrder.objects.exists())

    def test_checkout_uses_delivery_region_fee(self) -> None:
        """Checkout should use the selected active delivery region fee."""
        client = self._checkout_client(
            address="Rua A, 123", neighborhood="Centro", city="Salvador"
        )
        region = DeliveryRegion.objects.create(
            name="Centro expandido",
            city="Salvador",
            delivery_fee=Decimal("18.50"),
        )
        payload = {
            "items": [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "delivery_region_id": region.id,
                "notes": "",
            },
        }

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["delivery_fee"], "18.50")
        self.assertEqual(response.data["total"], "61.00")
        self.assertEqual(
            response.data["customer"]["delivery_region_name"], "Centro expandido"
        )
        self.assertIn("Regiao: Centro expandido", response.data["message"])

    def test_checkout_rejects_a_delivery_region_from_another_store(self) -> None:
        """A delivery_region_id that belongs to a different tenant must never
        resolve -- the storefront customer here is scoped to the default store,
        so store B's region is as good as non-existent and its fee is unusable.
        """
        client = self._checkout_client(
            address="Rua A, 123", neighborhood="Centro", city="Salvador"
        )
        store_b = Store.objects.create(name="Loja B", slug="loja-b")
        foreign_region = DeliveryRegion.objects.create(
            name="Centro",
            city="Salvador",
            delivery_fee=Decimal("999.00"),
            store=store_b,
        )
        payload = {
            "items": [{"product_id": self.product.id, "quantity": 1}],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "delivery_region_id": foreign_region.id,
                "notes": "",
            },
        }

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        # online-sales foundation: a region that does not resolve for this
        # store is a commercial rejection with a stable code, not a field
        # validation error.
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["code"], "delivery_region_unavailable")
        self.assertFalse(SaleOrder.objects.exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)

    def test_checkout_rejects_an_inactive_delivery_region(self) -> None:
        """An inactive region for the right store is still unusable at checkout,
        and the request fails loudly instead of silently charging another fee.
        """
        client = self._checkout_client(
            address="Rua A, 123", neighborhood="Centro", city="Salvador"
        )
        inactive_region = DeliveryRegion.objects.create(
            name="Centro desativado",
            city="Salvador",
            delivery_fee=Decimal("18.50"),
            is_active=False,
        )
        payload = {
            "items": [{"product_id": self.product.id, "quantity": 1}],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "delivery_region_id": inactive_region.id,
                "notes": "",
            },
        }

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["code"], "delivery_region_unavailable")
        self.assertFalse(SaleOrder.objects.exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 8)

    def test_checkout_idempotency_recovers_from_a_concurrent_insert_race(
        self,
    ) -> None:
        """Losing side of a true race: the pre-flight idempotency lookup runs
        before the winner's row is visible, so the request proceeds into the
        transaction and trips the per-store unique constraint. It must recover
        by returning the winner's order -- one SaleOrder, stock decremented once
        -- not surface a 500 or double-reserve stock.
        """
        client = self._checkout_client()
        payload = self._build_pickup_payload(
            [{"product_id": self.product.id, "quantity": 2}]
        )
        payload["idempotency_key"] = "checkout-race-1"

        first_response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)

        real_check = CheckoutWhatsAppView._idempotent_response_or_conflict
        calls = {"count": 0}

        def blind_first_lookup(view_self, **kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                return None  # winner's committed row not visible yet
            return real_check(view_self, **kwargs)

        with patch.object(
            CheckoutWhatsAppView,
            "_idempotent_response_or_conflict",
            blind_first_lookup,
        ):
            second_response: Any = client.post(
                "/api/v1/checkout/whatsapp/", payload, format="json"
            )

        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            second_response.data["order_reference"],
            first_response.data["order_reference"],
        )
        self.assertEqual(SaleOrder.objects.count(), 1)
        self.assertEqual(
            StockMovement.objects.filter(product=self.product).count(), 1
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, 6)

    def test_checkout_falls_back_to_default_delivery_fee_without_a_region(
        self,
    ) -> None:
        """Delivery checkout with no resolvable delivery region must still
        charge the configured ORDER_DELIVERY_FEE default, not R$0.00.

        Regression test: a prior refactor of the delivery-fee branch dropped
        the `else settings.ORDER_DELIVERY_FEE` fallback, so any delivery
        checkout without a matching active DeliveryRegion silently charged
        zero delivery fee.
        """
        client = self._checkout_client(
            address="Rua A, 123", neighborhood="Centro", city="Salvador"
        )
        payload = {
            "items": [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "notes": "",
            },
        }

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["delivery_fee"], f"{settings.ORDER_DELIVERY_FEE:.2f}"
        )
        self.assertEqual(
            response.data["total"],
            f"{self.product.price + settings.ORDER_DELIVERY_FEE:.2f}",
        )

    def test_public_delivery_regions_returns_only_active_regions(self) -> None:
        """Public active regions endpoint should hide inactive options."""
        DeliveryRegion.objects.create(
            name="Centro", city="Salvador", delivery_fee=Decimal("12.00")
        )
        DeliveryRegion.objects.create(
            name="Inativa",
            city="Salvador",
            delivery_fee=Decimal("22.00"),
            is_active=False,
        )

        response: Any = self.client.get("/api/v1/delivery-regions/active/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["name"], "Centro")

    def test_delivery_region_list_hides_inactive_for_anonymous_users(self) -> None:
        """Public delivery region list should not expose inactive regions."""
        DeliveryRegion.objects.create(
            name="Centro", city="Salvador", delivery_fee=Decimal("12.00")
        )
        DeliveryRegion.objects.create(
            name="Inativa",
            city="Salvador",
            delivery_fee=Decimal("22.00"),
            is_active=False,
        )

        response: Any = self.client.get("/api/v1/delivery-regions/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Centro")

    def test_delivery_region_list_hides_inactive_for_regular_authenticated_users(
        self,
    ) -> None:
        """Authenticated users without dashboard role should only see active regions."""
        user = User.objects.create_user(
            username="regularregion", password="testpass123"
        )
        DeliveryRegion.objects.create(
            name="Centro", city="Salvador", delivery_fee=Decimal("12.00")
        )
        DeliveryRegion.objects.create(
            name="Inativa",
            city="Salvador",
            delivery_fee=Decimal("22.00"),
            is_active=False,
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.get("/api/v1/delivery-regions/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Centro")

    def test_delivery_region_list_exposes_inactive_for_dashboard_users(self) -> None:
        """Dashboard users should see active and inactive delivery regions."""
        user = User.objects.create_user(
            username="dashboardregion",
            password="testpass123",
            is_staff=True,
        )
        DeliveryRegion.objects.create(
            name="Centro", city="Salvador", delivery_fee=Decimal("12.00")
        )
        DeliveryRegion.objects.create(
            name="Inativa",
            city="Salvador",
            delivery_fee=Decimal("22.00"),
            is_active=False,
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.get("/api/v1/delivery-regions/")

        region_names = {region["name"] for region in response.data["results"]}
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 2)
        self.assertSetEqual(region_names, {"Centro", "Inativa"})

    def test_regular_authenticated_user_cannot_create_delivery_region(self) -> None:
        """Registered non-dashboard users should not mutate freight rules."""
        user = User.objects.create_user(
            username="regularfreight", password="testpass123"
        )
        self.client.force_authenticate(user=user)
        payload = {
            "name": "Bloqueada",
            "city": "Salvador",
            "delivery_fee": "30.00",
            "is_active": True,
        }

        response: Any = self.client.post(
            "/api/v1/delivery-regions/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(DeliveryRegion.objects.filter(name="Bloqueada").exists())

    def test_sales_history_requires_authentication(self) -> None:
        """Sales history is a dashboard-only authenticated endpoint."""
        response: Any = self.client.get("/api/v1/sales-orders/")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_sales_history_denies_regular_authenticated_users(self) -> None:
        """Registered users without a dashboard role should not see private sales data."""
        user = User.objects.create_user(username="regularsales", password="testpass123")
        self.client.force_authenticate(user=user)

        response: Any = self.client.get("/api/v1/sales-orders/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_sales_history_returns_checkout_orders(self) -> None:
        """Authenticated dashboard users should see persisted checkout orders."""
        user = User.objects.create_user(
            username="salesuser",
            password="testpass123",
            is_staff=True,
        )

        checkout_client = self._checkout_client()
        payload = {
            "items": [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ],
            "customer": {
                "delivery_method": "pickup",
                "payment_method": "card",
                "notes": "",
            },
        }
        checkout_response: Any = checkout_client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.get("/api/v1/sales-orders/?page_size=5")

        self.assertEqual(checkout_response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["results"][0]["order_reference"],
            checkout_response.data["order_reference"],
        )
        self.assertEqual(response.data["results"][0]["item_count"], 1)

    def test_dashboard_writer_can_update_sale_order_status(self) -> None:
        """Dashboard operators should move orders through operational states."""
        user = User.objects.create_user(
            username="saleswriter",
            password="testpass123",
            is_staff=True,
        )
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="delivery",
            payment_method="pix",
            subtotal=Decimal("42.50"),
            delivery_fee=Decimal("0.00"),
            total=Decimal("42.50"),
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",
            {
                "status": "sent",
                "carrier_name": "Correios",
                "tracking_code": "AB123456789BR",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "sent")
        order.refresh_from_db()
        self.assertEqual(order.status, "sent")

    def test_dashboard_reader_cannot_update_sale_order_status(self) -> None:
        """Read-only dashboard users can inspect orders but cannot mutate them."""
        viewer_group, _ = Group.objects.get_or_create(name="viewer")
        user = User.objects.create_user(username="salesviewer", password="testpass123")
        user.groups.add(viewer_group)
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=Decimal("42.50"),
            delivery_fee=Decimal("0.00"),
            total=Decimal("42.50"),
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",
            {"status": "cancelled"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        order.refresh_from_db()
        self.assertEqual(order.status, SaleOrder.STATUS_PREPARED)

    def test_sale_order_status_update_rejects_invalid_status(self) -> None:
        """Status updates should stay inside the explicit order workflow."""
        user = User.objects.create_user(
            username="salesinvalid",
            password="testpass123",
            is_staff=True,
        )
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=Decimal("42.50"),
            delivery_fee=Decimal("0.00"),
            total=Decimal("42.50"),
        )

        self.client.force_authenticate(user=user)
        response: Any = self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",
            {"status": "shipped"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, SaleOrder.STATUS_PREPARED)

    def test_checkout_requires_delivery_address_for_delivery_orders(self) -> None:
        """Delivery orders need a complete address, from the profile or the request.

        Guest checkout reinstated: a customer's profile without an address no
        longer blocks checkout outright -- it just falls back to requiring the
        address in the request itself, same as a guest. Omitting both is what
        this test covers.
        """
        client = self._checkout_client()  # no address/neighborhood/city set
        payload = {
            "items": [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "notes": "",
            },
        }
        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "guest_address_incomplete")
        self.assertEqual(SaleOrder.objects.count(), 0)

    def test_checkout_saves_submitted_delivery_address_to_customer_profile(
        self,
    ) -> None:
        """The first checkout address for a logged-in customer becomes the saved default."""
        email = "cliente-endereco@teste.com"
        client = self._checkout_client(email=email)  # profile starts without address
        region = DeliveryRegion.objects.create(
            name="Pituba",
            city="Salvador",
            delivery_fee=Decimal("15.00"),
        )
        payload = {
            "items": [
                {
                    "product_id": self.product.id,  # type: ignore[arg-type]
                    "quantity": 1,
                }
            ],
            "customer": {
                "delivery_method": "delivery",
                "payment_method": "pix",
                "delivery_region_id": region.id,
                "address": "Rua da Cliente, 123",
                "neighborhood": "Pituba",
                "city": "Salvador",
                "notes": "",
            },
        }

        response: Any = client.post(
            "/api/v1/checkout/whatsapp/", payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        profile = CustomerProfile.objects.get(user__email=email)
        self.assertEqual(profile.address, "Rua da Cliente, 123")
        self.assertEqual(profile.neighborhood, "Pituba")
        self.assertEqual(profile.city, "Salvador")
        self.assertEqual(profile.delivery_region_id, region.id)
        self.assertEqual(response.data["customer"]["address"], "Rua da Cliente, 123")


class SaleOrderSummaryAPITest(TestCase):
    """Real sales revenue aggregation backing the dashboard's revenue card."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salessummary", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

    def _make_order(
        self, total: Decimal, days_ago: int, order_status: str = "prepared"
    ) -> SaleOrder:
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=total,
            delivery_fee=Decimal("0.00"),
            total=total,
            status=order_status,
        )
        SaleOrder.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return order

    def test_summary_aggregates_revenue_orders_and_average_ticket(self) -> None:
        """Revenue, order count and average ticket should reflect real sales, not stock."""
        self._make_order(Decimal("50.00"), days_ago=1)
        self._make_order(Decimal("30.00"), days_ago=2)

        response: Any = self.client.get("/api/v1/sales-orders/summary/?period=7d")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["orders_count"], 2)
        self.assertEqual(response.data["revenue_total"], "80.00")
        self.assertEqual(response.data["average_ticket"], "40.00")

    def test_summary_excludes_cancelled_orders(self) -> None:
        """Cancelled orders never reached the customer and should not count as revenue."""
        self._make_order(Decimal("50.00"), days_ago=1)
        self._make_order(Decimal("999.00"), days_ago=1, order_status="cancelled")

        response: Any = self.client.get("/api/v1/sales-orders/summary/?period=7d")

        self.assertEqual(response.data["orders_count"], 1)
        self.assertEqual(response.data["revenue_total"], "50.00")

    def test_summary_compares_against_previous_period(self) -> None:
        """The comparison field is a % change against the immediately preceding window."""
        self._make_order(Decimal("100.00"), days_ago=1)
        self._make_order(Decimal("50.00"), days_ago=10)

        response: Any = self.client.get("/api/v1/sales-orders/summary/?period=7d")

        self.assertEqual(response.data["revenue_total"], "100.00")
        self.assertEqual(response.data["comparison_previous_period"], "100.00")

    def test_summary_compares_against_same_period_last_year(self) -> None:
        """A second comparison field measures growth against the same window, one year back."""
        self._make_order(Decimal("100.00"), days_ago=5)
        self._make_order(Decimal("50.00"), days_ago=380)

        response: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")

        self.assertEqual(response.data["revenue_total"], "100.00")
        self.assertEqual(response.data["comparison_same_period_last_year"], "100.00")

    def test_summary_unknown_period_falls_back_to_30d(self) -> None:
        """An invalid period query param should not error out the dashboard."""
        response: Any = self.client.get("/api/v1/sales-orders/summary/?period=invalid")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "30d")

    def test_summary_requires_dashboard_read_role(self) -> None:
        """Registered users without a dashboard role should not see revenue data."""
        viewer = User.objects.create_user(
            username="summaryregular", password="testpass123"
        )
        client = APIClient()
        client.force_authenticate(user=viewer)

        response: Any = client.get("/api/v1/sales-orders/summary/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class SaleOrderTimeseriesAPITest(TestCase):
    """Daily revenue/order points backing the dashboard's trend chart."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salestimeseries", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

    def _make_order(
        self, total: Decimal, days_ago: int, order_status: str = "prepared"
    ) -> SaleOrder:
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=total,
            delivery_fee=Decimal("0.00"),
            total=total,
            status=order_status,
        )
        SaleOrder.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return order

    def test_timeseries_returns_one_point_per_day_with_zero_filled_gaps(self) -> None:
        """Days with no sales must still appear as zero-revenue points, not gaps."""
        self._make_order(Decimal("50.00"), days_ago=0)
        self._make_order(Decimal("30.00"), days_ago=2)

        response: Any = self.client.get("/api/v1/sales-orders/timeseries/?period=7d")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 7)
        revenue_by_date = {point["date"]: point["revenue"] for point in response.data}
        today_local = timezone.localtime(timezone.now()).date()
        self.assertEqual(revenue_by_date[today_local.isoformat()], "50.00")
        self.assertEqual(
            revenue_by_date[(today_local - timedelta(days=2)).isoformat()], "30.00"
        )
        self.assertEqual(
            revenue_by_date[(today_local - timedelta(days=1)).isoformat()], "0.00"
        )

    def test_timeseries_excludes_cancelled_orders(self) -> None:
        """A cancelled order's total should not inflate the trend chart."""
        self._make_order(Decimal("999.00"), days_ago=0, order_status="cancelled")

        response: Any = self.client.get("/api/v1/sales-orders/timeseries/?period=7d")

        today_local = timezone.localtime(timezone.now()).date()
        revenue_by_date = {point["date"]: point["revenue"] for point in response.data}
        self.assertEqual(revenue_by_date[today_local.isoformat()], "0.00")

    def test_timeseries_unknown_period_falls_back_to_30d(self) -> None:
        """An invalid period query param should not error out the dashboard."""
        response: Any = self.client.get(
            "/api/v1/sales-orders/timeseries/?period=invalid"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 30)


class SaleOrderBreakdownAPITest(TestCase):
    """Top products, payment method and status breakdown for the dashboard."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salesbreakdown", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)
        self.category = Category.objects.create(name="Lanches")
        self.product = Product.objects.create(
            name="Combo Executivo",
            sku="CMB-BRK",
            price=Decimal("25.00"),
            stock_quantity=20,
            category=self.category,
        )

    def _make_order(
        self,
        total: Decimal,
        days_ago: int = 0,
        order_status: str = "prepared",
        payment_method: str = "pix",
        delivery_method: str = "pickup",
        delivery_region_name: str = "",
    ) -> SaleOrder:
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method=delivery_method,
            delivery_region_name=delivery_region_name,
            payment_method=payment_method,
            subtotal=total,
            delivery_fee=Decimal("0.00"),
            total=total,
            status=order_status,
        )
        SaleOrder.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return order

    def test_breakdown_ranks_top_products_by_revenue(self) -> None:
        """The best seller by revenue should be first, with quantity and revenue summed."""
        order = self._make_order(Decimal("50.00"))
        SaleOrderItem.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            sku=self.product.sku,
            quantity=2,
            unit_price=Decimal("25.00"),
            line_total=Decimal("50.00"),
        )

        response: Any = self.client.get("/api/v1/sales-orders/breakdown/?period=30d")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        top_products = response.data["top_products"]
        self.assertEqual(len(top_products), 1)
        self.assertEqual(top_products[0]["product_name"], "Combo Executivo")
        self.assertEqual(top_products[0]["quantity_total"], 2)
        self.assertEqual(top_products[0]["revenue_total"], "50.00")

    def test_breakdown_groups_revenue_by_payment_method(self) -> None:
        """Active orders should be grouped by how the customer paid."""
        self._make_order(Decimal("40.00"), payment_method="pix")
        self._make_order(Decimal("60.00"), payment_method="card")
        self._make_order(
            Decimal("999.00"), payment_method="cash", order_status="cancelled"
        )

        response: Any = self.client.get("/api/v1/sales-orders/breakdown/?period=30d")

        by_payment_method = {
            row["payment_method"]: row["revenue_total"]
            for row in response.data["by_payment_method"]
        }
        self.assertEqual(by_payment_method, {"card": "60.00", "pix": "40.00"})

    def test_breakdown_includes_cancelled_orders_in_status_distribution(self) -> None:
        """Status distribution is the one place cancelled orders should still count."""
        self._make_order(Decimal("40.00"), order_status="prepared")
        self._make_order(Decimal("999.00"), order_status="cancelled")

        response: Any = self.client.get("/api/v1/sales-orders/breakdown/?period=30d")

        by_status = {
            row["status"]: row["orders_count"] for row in response.data["by_status"]
        }
        self.assertEqual(by_status, {"prepared": 1, "cancelled": 1})

    def test_breakdown_groups_revenue_by_delivery_region(self) -> None:
        """Pickup orders, named regions and unnamed deliveries each bucket separately."""
        self._make_order(Decimal("30.00"), delivery_method="pickup")
        self._make_order(
            Decimal("50.00"), delivery_method="delivery", delivery_region_name="Centro"
        )
        self._make_order(
            Decimal("20.00"), delivery_method="delivery", delivery_region_name=""
        )

        response: Any = self.client.get("/api/v1/sales-orders/breakdown/?period=30d")

        by_region = {
            row["region"]: row["revenue_total"] for row in response.data["by_region"]
        }
        self.assertEqual(
            by_region,
            {"Retirada na loja": "30.00", "Centro": "50.00", "Sem regiao": "20.00"},
        )

    def test_breakdown_unknown_period_falls_back_to_30d(self) -> None:
        """An invalid period query param should not error out the dashboard."""
        response: Any = self.client.get(
            "/api/v1/sales-orders/breakdown/?period=invalid"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "30d")

    def test_breakdown_accepts_90d_to_match_the_trend_chart_period_switcher(
        self,
    ) -> None:
        """The dashboard's period switcher offers 7d/30d/90d for both endpoints."""
        self._make_order(Decimal("40.00"), days_ago=45)

        response: Any = self.client.get("/api/v1/sales-orders/breakdown/?period=90d")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "90d")
        by_status = {
            row["status"]: row["orders_count"] for row in response.data["by_status"]
        }
        self.assertEqual(by_status, {"prepared": 1})


class SaleOrderAggregateCacheTest(TestCase):
    """Dashboard aggregate endpoints cache briefly, scoped per store."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salescache", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

    def _make_order(self, total: Decimal) -> SaleOrder:
        return SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=total,
            delivery_fee=Decimal("0.00"),
            total=total,
        )

    def test_summary_response_is_cached_between_identical_requests(self) -> None:
        """Two requests with no write in between must reuse the cached value."""
        self._make_order(Decimal("50.00"))
        first: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(first.data["revenue_total"], "50.00")

        second: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(second.data["revenue_total"], "50.00")

    def test_new_order_invalidates_the_cached_summary(self) -> None:
        """A new SaleOrder must bust the cache so the dashboard never serves stale revenue."""
        self._make_order(Decimal("50.00"))
        first: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(first.data["revenue_total"], "50.00")

        self._make_order(Decimal("100.00"))
        second: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(second.data["revenue_total"], "150.00")

    def test_status_update_invalidates_the_cached_summary(self) -> None:
        """Cancelling an order must immediately drop it out of the cached revenue total."""
        order = self._make_order(Decimal("50.00"))
        first: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(first.data["revenue_total"], "50.00")

        response: Any = self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",  # type: ignore
            {"status": "cancelled"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        second: Any = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(second.data["revenue_total"], "0.00")

    def test_cached_summary_does_not_leak_across_stores(self) -> None:
        """Two different stores must never share a cached aggregate, even by coincidence."""
        self._make_order(Decimal("50.00"))
        self.client.get("/api/v1/sales-orders/summary/?period=30d")

        other_store = Store.objects.create(name="Outra Loja", slug="outra-loja")
        other_user = User.objects.create_user(
            username="salescacheother", password="testpass123", is_staff=True
        )
        other_client = APIClient()
        other_client.force_authenticate(
            user=other_user, token={"store_id": other_store.id}
        )

        response: Any = other_client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(response.data["revenue_total"], "0.00")


class SaleOrderCustomRangeAPITest(TestCase):
    """An explicit ?start=&end= range overrides the period shorthand on all three endpoints."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salescustomrange", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

    def _make_order(self, total: Decimal, days_ago: int) -> SaleOrder:
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone="71999990000",
            delivery_method="pickup",
            payment_method="pix",
            subtotal=total,
            delivery_fee=Decimal("0.00"),
            total=total,
        )
        SaleOrder.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return order

    def _date_str(self, days_ago: int) -> str:
        return (
            (timezone.localtime(timezone.now()) - timedelta(days=days_ago))
            .date()
            .isoformat()
        )

    def test_summary_uses_custom_range_instead_of_period(self) -> None:
        self._make_order(Decimal("40.00"), days_ago=10)
        self._make_order(Decimal("999.00"), days_ago=40)

        response: Any = self.client.get(
            f"/api/v1/sales-orders/summary/?start={self._date_str(15)}&end={self._date_str(5)}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "custom")
        self.assertEqual(response.data["revenue_total"], "40.00")

    def test_timeseries_uses_custom_range_instead_of_period(self) -> None:
        self._make_order(Decimal("40.00"), days_ago=10)

        response: Any = self.client.get(
            f"/api/v1/sales-orders/timeseries/?start={self._date_str(15)}&end={self._date_str(5)}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 11)
        revenue_by_date = {point["date"]: point["revenue"] for point in response.data}
        self.assertEqual(revenue_by_date[self._date_str(10)], "40.00")

    def test_breakdown_uses_custom_range_instead_of_period(self) -> None:
        self._make_order(Decimal("40.00"), days_ago=10)

        response: Any = self.client.get(
            f"/api/v1/sales-orders/breakdown/?start={self._date_str(15)}&end={self._date_str(5)}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "custom")
        by_status = {
            row["status"]: row["orders_count"] for row in response.data["by_status"]
        }
        self.assertEqual(by_status, {"prepared": 1})

    def test_invalid_custom_range_falls_back_to_default_period(self) -> None:
        response: Any = self.client.get(
            "/api/v1/sales-orders/summary/?start=not-a-date&end=also-not-a-date"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "30d")

    def test_start_after_end_falls_back_to_default_period(self) -> None:
        response: Any = self.client.get(
            f"/api/v1/sales-orders/summary/?start={self._date_str(5)}&end={self._date_str(15)}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "30d")

    def test_custom_ranges_do_not_share_a_cache_entry(self) -> None:
        """A different start/end must never reuse another range's cached aggregate."""
        self._make_order(Decimal("40.00"), days_ago=10)

        first: Any = self.client.get(
            f"/api/v1/sales-orders/summary/?start={self._date_str(15)}&end={self._date_str(5)}"
        )
        second: Any = self.client.get(
            f"/api/v1/sales-orders/summary/?start={self._date_str(45)}&end={self._date_str(35)}"
        )

        self.assertEqual(first.data["revenue_total"], "40.00")
        self.assertEqual(second.data["revenue_total"], "0.00")


class SaleOrderCustomerInsightsAPITest(TestCase):
    """Bot-to-sale conversion rate and new-vs-returning customer mix."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="salescustomers", password="testpass123", is_staff=True
        )
        self.client.force_authenticate(user=self.user)

    def _make_order(self, customer_phone: str, days_ago: int = 0) -> SaleOrder:
        order = SaleOrder.objects.create(
            order_reference=f"BPF-{uuid4().hex[:8].upper()}",
            customer_name="Cliente Teste",
            customer_phone=customer_phone,
            delivery_method="pickup",
            payment_method="pix",
            subtotal=Decimal("10.00"),
            delivery_fee=Decimal("0.00"),
            total=Decimal("10.00"),
        )
        SaleOrder.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return order

    def _make_conversation(
        self, days_ago: int = 0, converted: bool = False
    ) -> BotConversation:
        conversation = BotConversation.objects.create(store=Store.get_default())
        if converted:
            conversation.sale_order = self._make_order("71900000000", days_ago=days_ago)
            conversation.save(update_fields=["sale_order"])
        BotConversation.objects.filter(pk=conversation.pk).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )
        return conversation

    def test_classifies_new_and_returning_customers_by_phone(self) -> None:
        """A phone seen before the period started counts as returning, not new."""
        self._make_order("71999990000", days_ago=40)
        self._make_order("71999990000", days_ago=5)
        self._make_order("71988880000", days_ago=3)

        response: Any = self.client.get("/api/v1/sales-orders/customers/?period=30d")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["new_customers"], 1)
        self.assertEqual(response.data["returning_customers"], 1)

    def test_normalizes_phone_formatting_before_comparing(self) -> None:
        """Different formatting of the same number should still match as one customer."""
        self._make_order("(71) 99999-0000", days_ago=40)
        self._make_order("71999990000", days_ago=5)

        response: Any = self.client.get("/api/v1/sales-orders/customers/?period=30d")

        self.assertEqual(response.data["returning_customers"], 1)
        self.assertEqual(response.data["new_customers"], 0)

    def test_computes_bot_conversion_rate(self) -> None:
        """Conversion rate is converted conversations over total conversations in the period."""
        self._make_conversation(days_ago=5, converted=True)
        self._make_conversation(days_ago=5, converted=False)

        response: Any = self.client.get("/api/v1/sales-orders/customers/?period=30d")

        self.assertEqual(response.data["bot_conversations_count"], 2)
        self.assertEqual(response.data["bot_converted_count"], 1)
        self.assertEqual(response.data["bot_conversion_rate"], "50.00")

    def test_conversion_rate_is_null_without_any_conversations(self) -> None:
        """An empty denominator should not be reported as a misleading 0%."""
        response: Any = self.client.get("/api/v1/sales-orders/customers/?period=30d")

        self.assertEqual(response.data["bot_conversations_count"], 0)
        self.assertIsNone(response.data["bot_conversion_rate"])

    def test_unknown_period_falls_back_to_30d(self) -> None:
        """An invalid period query param should not error out the dashboard."""
        response: Any = self.client.get(
            "/api/v1/sales-orders/customers/?period=invalid"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["period"], "30d")
