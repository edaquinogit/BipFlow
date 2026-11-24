from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from bipdelivery.api.models import Category, Product, Store, StoreMembership, StoreShippingSettings
from bipdelivery.api.serializers import ProductSerializer, StoreShippingSettingsSerializer


class ShippingLogisticsFoundationTests(TestCase):
    def setUp(self):
        self.store_a = Store.objects.create(name="Loja A", slug="loja-a")
        self.store_b = Store.objects.create(name="Loja B", slug="loja-b")

    def test_each_store_gets_its_own_shipping_settings(self):
        settings_a = StoreShippingSettings.get_for_store(self.store_a)
        settings_b = StoreShippingSettings.get_for_store(self.store_b)

        self.assertNotEqual(settings_a.pk, settings_b.pk)
        self.assertEqual(settings_a.store_id, self.store_a.pk)
        self.assertEqual(settings_b.store_id, self.store_b.pk)
        self.assertFalse(settings_a.national_shipping_enabled)
        self.assertFalse(settings_b.national_shipping_enabled)

    def test_settings_serializer_normalizes_cep_and_validates_package_dimensions(self):
        settings_row = StoreShippingSettings.get_for_store(self.store_a)
        serializer = StoreShippingSettingsSerializer(
            settings_row,
            data={
                "origin_postal_code": "12345-678",
                "packaging_weight_grams": 120,
                "package_options": [
                    {
                        "name": "Caixa pequena",
                        "length_cm": 20,
                        "width_cm": 15,
                        "height_cm": 10,
                        "tare_weight_grams": 80,
                    }
                ],
                # This flag is read-only until the shipping calculation stage exists.
                "national_shipping_enabled": True,
            },
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        saved = serializer.save()
        self.assertEqual(saved.origin_postal_code, "12345678")
        self.assertEqual(saved.packaging_weight_grams, 120)
        self.assertFalse(saved.national_shipping_enabled)
        self.assertEqual(saved.package_options[0]["tare_weight_grams"], 80)

    def test_settings_serializer_rejects_non_positive_package_dimensions(self):
        settings_row = StoreShippingSettings.get_for_store(self.store_a)
        serializer = StoreShippingSettingsSerializer(
            settings_row,
            data={
                "package_options": [
                    {
                        "name": "Caixa inválida",
                        "length_cm": 0,
                        "width_cm": 15,
                        "height_cm": 10,
                        "tare_weight_grams": 0,
                    }
                ]
            },
            partial=True,
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("package_options", serializer.errors)

    def test_settings_serializer_rejects_invalid_tare_weights(self):
        settings_row = StoreShippingSettings.get_for_store(self.store_a)
        for weight in (1.5, -0.5, -1, "NaN", "Infinity", True, None):
            with self.subTest(weight=weight):
                serializer = StoreShippingSettingsSerializer(
                    settings_row,
                    data={
                        "package_options": [
                            {
                                "name": "Caixa",
                                "length_cm": 20,
                                "width_cm": 15,
                                "height_cm": 10,
                                "tare_weight_grams": weight,
                            }
                        ]
                    },
                    partial=True,
                )
                self.assertFalse(serializer.is_valid())
                self.assertIn("package_options", serializer.errors)

    def test_existing_products_can_keep_logistics_fields_empty(self):
        category = Category.objects.create(store=self.store_a, name="Geral")
        product = Product.objects.create(
            store=self.store_a,
            category=category,
            name="Produto sem dimensões",
            price="19.90",
        )

        self.assertIsNone(product.weight_grams)
        self.assertIsNone(product.length_cm)
        self.assertIsNone(product.width_cm)
        self.assertIsNone(product.height_cm)

        payload = ProductSerializer(product).data
        self.assertIsNone(payload["weight_grams"])
        self.assertIsNone(payload["length_cm"])
        self.assertIsNone(payload["width_cm"])
        self.assertIsNone(payload["height_cm"])


class ShippingSettingsApiIsolationTests(TestCase):
    url = "/api/v1/store/current/shipping-settings/"

    def setUp(self):
        self.store_a = Store.get_default()
        self.store_b = Store.objects.create(name="Loja B", slug="shipping-loja-b")
        self.settings_a = StoreShippingSettings.get_for_store(self.store_a)
        self.settings_b = StoreShippingSettings.get_for_store(self.store_b)
        self.settings_a.origin_postal_code = "40010000"
        self.settings_a.save()
        self.settings_b.origin_postal_code = "49010000"
        self.settings_b.save()
        self.client = APIClient()

    def authenticate(self, role, claim=None):
        user = get_user_model().objects.create_user(username=f"shipping-{role}")
        StoreMembership.objects.create(store=self.store_a, user=user, role=role)
        self.client.force_authenticate(
            user=user, token={"store_id": claim or self.store_a.pk}
        )

    def test_anonymous_cannot_read_or_write(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.patch(self.url, {}, format="json").status_code, 401)

    def test_owner_cannot_read_or_modify_foreign_store_via_header(self):
        self.authenticate(StoreMembership.ROLE_OWNER)
        header = {"HTTP_X_STORE_SLUG": self.store_b.slug}
        response = self.client.get(self.url, **header)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["origin_postal_code"], "40010000")
        response = self.client.patch(
            self.url, {"origin_postal_code": "50010000", "store": self.store_b.pk},
            format="json", **header,
        )
        self.assertEqual(response.status_code, 200)
        self.settings_a.refresh_from_db()
        self.settings_b.refresh_from_db()
        self.assertEqual(self.settings_a.origin_postal_code, "50010000")
        self.assertEqual(self.settings_b.origin_postal_code, "49010000")

    def test_foreign_claim_is_denied(self):
        self.authenticate(StoreMembership.ROLE_OWNER, claim=self.store_b.pk)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.patch(self.url, {}, format="json").status_code, 403)

    def test_viewer_can_read_but_cannot_edit(self):
        self.authenticate(StoreMembership.ROLE_VIEWER)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        response = self.client.patch(
            self.url, {"origin_postal_code": "50010000"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.settings_a.refresh_from_db()
        self.assertEqual(self.settings_a.origin_postal_code, "40010000")

    def test_manager_can_edit_own_store(self):
        self.authenticate(StoreMembership.ROLE_MANAGER)
        response = self.client.patch(
            self.url, {"origin_postal_code": "50010000"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.settings_a.refresh_from_db()
        self.assertEqual(self.settings_a.origin_postal_code, "50010000")

    def test_non_member_cannot_access_settings(self):
        user = get_user_model().objects.create_user(username="shipping-customer")
        self.client.force_authenticate(user=user)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.patch(self.url, {}, format="json").status_code, 403)
