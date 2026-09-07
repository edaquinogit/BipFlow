"""
Authentication endpoint throttling tests.

These tests keep the production defaults independent from the assertions by
overriding throttle rates to small windows and clearing Django's cache between
cases.
"""

import os
from typing import Any

import django
import pyotp
import pytest
from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.test import APIClient

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bipdelivery.core.settings")
django.setup()

from bipdelivery.api.mfa import build_mfa_challenge_token  # noqa: E402
from bipdelivery.api.models import TOTPDevice  # noqa: E402
from bipdelivery.api.throttling import REFRESH_TOKEN_COOKIE_NAME  # noqa: E402
from bipdelivery.tests.throttle_utils import rest_framework_with_rates  # noqa: E402

pytestmark = pytest.mark.django_db


AUTH_THROTTLE_TEST_REST_FRAMEWORK = rest_framework_with_rates(
    auth_ip="2/minute",
    auth_login_identity="2/minute",
    auth_register_identity="1/minute",
    auth_password_reset_identity="1/minute",
    auth_password_reset_confirm_identity="1/minute",
    auth_token_refresh_ip="20/minute",
    auth_token_refresh_identity="1/minute",
    # High enough to never trip on its own during the identity test below,
    # which spreads attempts across distinct IPs.
    mfa_verify_ip="100/minute",
    mfa_verify_identity="2/minute",
)


class AuthEndpointThrottlingTest(TestCase):
    client: APIClient
    user: User

    def setUp(self) -> None:
        self.settings_override = override_settings(REST_FRAMEWORK=AUTH_THROTTLE_TEST_REST_FRAMEWORK)
        self.settings_override.enable()
        api_settings.reload()
        self.original_throttle_rates = SimpleRateThrottle.THROTTLE_RATES
        SimpleRateThrottle.THROTTLE_RATES = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="admin@example.com",
            email="admin@example.com",
            password="securepass123",
        )

    def tearDown(self) -> None:
        cache.clear()
        SimpleRateThrottle.THROTTLE_RATES = self.original_throttle_rates
        self.settings_override.disable()
        api_settings.reload()

    def test_login_is_throttled_by_client_ip(self) -> None:
        payload = {"username": "unknown@example.com", "password": "wrong-password"}
        cors_origin = "http://localhost:5173"

        for _ in range(2):
            response: Any = self.client.post(
                "/api/auth/token/",
                payload,
                format="json",
                HTTP_ORIGIN=cors_origin,
            )
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        response = self.client.post(
            "/api/auth/token/",
            payload,
            format="json",
            HTTP_ORIGIN=cors_origin,
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("Retry-After", response)
        self.assertEqual(response["Access-Control-Expose-Headers"], "Retry-After")

    def test_login_is_throttled_by_submitted_identity_across_ips(self) -> None:
        payload = {"username": self.user.username, "password": "wrong-password"}

        for index in range(2):
            response: Any = self.client.post(
                "/api/auth/token/",
                payload,
                format="json",
                REMOTE_ADDR=f"198.51.100.{index + 1}",
            )
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        response = self.client.post(
            "/api/auth/token/",
            payload,
            format="json",
            REMOTE_ADDR="198.51.100.10",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_register_is_throttled_by_submitted_email(self) -> None:
        payload = {
            "email": "new-user@example.com",
            "password": "short",
            "confirm_password": "short",
        }

        response: Any = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            "/api/auth/register/",
            payload,
            format="json",
            REMOTE_ADDR="198.51.100.20",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_password_reset_request_is_throttled_by_submitted_email(self) -> None:
        payload = {"email": "customer@example.com"}

        response: Any = self.client.post("/api/auth/password-reset/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.post(
            "/api/auth/password-reset/",
            payload,
            format="json",
            REMOTE_ADDR="198.51.100.30",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_password_reset_confirm_is_throttled_by_submitted_uid(self) -> None:
        payload = {
            "uid": urlsafe_base64_encode(force_bytes(9999)),
            "token": "invalid-token",
            "password": "new-secure-pass123",
            "confirm_password": "new-secure-pass123",
        }

        response: Any = self.client.post(
            "/api/auth/password-reset/confirm/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            payload,
            format="json",
            REMOTE_ADDR="198.51.100.40",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_mfa_verify_is_throttled_by_resolved_identity_across_ips(self) -> None:
        device = TOTPDevice(user=self.user)
        device.set_secret(pyotp.random_base32())
        device.confirmed = True
        device.save()

        for index in range(2):
            mfa_token = build_mfa_challenge_token(self.user.id)
            response: Any = self.client.post(
                "/api/auth/mfa/verify/",
                {"mfa_token": mfa_token, "code": "000000"},
                format="json",
                REMOTE_ADDR=f"198.51.100.{60 + index}",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        mfa_token = build_mfa_challenge_token(self.user.id)
        response = self.client.post(
            "/api/auth/mfa/verify/",
            {"mfa_token": mfa_token, "code": "000000"},
            format="json",
            REMOTE_ADDR="198.51.100.70",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_token_refresh_is_throttled_by_submitted_refresh_token(self) -> None:
        # The refresh token travels via the httpOnly cookie, not the body.
        self.client.cookies[REFRESH_TOKEN_COOKIE_NAME] = "invalid-refresh-token"

        response: Any = self.client.post("/api/auth/token/refresh/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        response = self.client.post(
            "/api/auth/token/refresh/",
            {},
            format="json",
            REMOTE_ADDR="198.51.100.50",
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
