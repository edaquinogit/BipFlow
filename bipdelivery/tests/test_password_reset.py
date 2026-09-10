"""Password-reset request endpoint (POST /api/auth/password-reset/).

Root-cause regression suite for the 2026-09 incident: a broken/unconfigured
SMTP backend made send_mail() raise, which surfaced as an unhandled HTTP 500
("Nao foi possivel enviar o link agora") and -- worse -- as an account
enumeration oracle (500 only for real accounts, 200 for everything else).

Run with:
    pytest bipdelivery/tests/test_password_reset.py -v
"""

import os
from smtplib import SMTPException
from typing import Any
from unittest.mock import patch

import django
import pytest
from django.conf import settings
from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.test import APIClient

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bipdelivery.core.settings")
django.setup()

from bipdelivery.tests.throttle_utils import rest_framework_with_rates  # noqa: E402

pytestmark = pytest.mark.django_db

RESET_URL = "/api/auth/password-reset/"

# Wide-open throttles: these tests assert delivery/enumeration behaviour, not
# rate limiting (that lives in test_auth_throttling.py).
_RELAXED_THROTTLES = rest_framework_with_rates(
    auth_ip="1000/minute",
    auth_password_reset_identity="1000/minute",
)

PROD_EMAIL_SETTINGS = dict(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_BASE_URL="https://bipflow.pages.dev",
)


@override_settings(**PROD_EMAIL_SETTINGS)
class PasswordResetRequestTest(TestCase):
    client: APIClient

    def setUp(self) -> None:
        self.settings_override = override_settings(REST_FRAMEWORK=_RELAXED_THROTTLES)
        self.settings_override.enable()
        api_settings.reload()
        self.original_throttle_rates = SimpleRateThrottle.THROTTLE_RATES
        SimpleRateThrottle.THROTTLE_RATES = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        cache.clear()
        self.client = APIClient()
        self.active_user = User.objects.create_user(
            username="owner@example.com", email="owner@example.com", password="oldpass123"
        )

    def tearDown(self) -> None:
        cache.clear()
        SimpleRateThrottle.THROTTLE_RATES = self.original_throttle_rates
        self.settings_override.disable()
        api_settings.reload()

    # -- happy path --------------------------------------------------------

    def test_active_user_gets_200_and_an_https_reset_link(self) -> None:
        response: Any = self.client.post(RESET_URL, {"email": "owner@example.com"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["owner@example.com"])
        self.assertIn("https://bipflow.pages.dev/reset-password?uid=", sent.body)
        self.assertIn("&token=", sent.body)

    def test_email_lookup_is_case_insensitive(self) -> None:
        response: Any = self.client.post(RESET_URL, {"email": "OWNER@Example.COM"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["owner@example.com"])

    # -- enumeration resistance -------------------------------------------

    def test_unknown_email_is_indistinguishable_from_a_hit(self) -> None:
        hit: Any = self.client.post(RESET_URL, {"email": "owner@example.com"}, format="json")
        cache.clear()
        miss: Any = self.client.post(RESET_URL, {"email": "nobody@example.com"}, format="json")

        self.assertEqual(hit.status_code, miss.status_code)
        self.assertEqual(hit.json(), miss.json())
        self.assertEqual(len(mail.outbox), 1)  # only the real account was mailed

    def test_inactive_user_gets_the_same_200_and_no_mail(self) -> None:
        User.objects.create_user(
            username="disabled@example.com",
            email="disabled@example.com",
            password="x",
            is_active=False,
        )
        response: Any = self.client.post(RESET_URL, {"email": "disabled@example.com"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_public_body_never_echoes_the_email_or_leaks_a_token(self) -> None:
        response: Any = self.client.post(RESET_URL, {"email": "owner@example.com"}, format="json")

        body = response.json()
        self.assertEqual(list(body.keys()), ["message"])
        self.assertNotIn("owner@example.com", response.content.decode())
        self.assertNotIn("token", response.content.decode().lower())

    # -- broken mailer ---------------------------------------------------

    def test_smtp_failure_returns_200_without_a_500_or_stack_trace(self) -> None:
        with patch(
            "bipdelivery.api.views.send_mail", side_effect=SMTPException("relay refused")
        ):
            with self.assertLogs("bipdelivery.api.views", level="ERROR") as logs:
                response: Any = self.client.post(
                    RESET_URL, {"email": "owner@example.com"}, format="json"
                )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), {
            "message": "Se este email existir, enviaremos um link seguro para redefinir a senha.",
        })
        # sanitized log: exception type only, never the address or a token
        joined = "\n".join(logs.output)
        self.assertIn("error_type=SMTPException", joined)
        self.assertNotIn("owner@example.com", joined)
        self.assertNotIn("relay refused", joined)

    def test_smtp_failure_for_real_account_matches_unknown_account_response(self) -> None:
        with patch("bipdelivery.api.views.send_mail", side_effect=SMTPException("boom")):
            broken_hit: Any = self.client.post(
                RESET_URL, {"email": "owner@example.com"}, format="json"
            )
        cache.clear()
        miss: Any = self.client.post(RESET_URL, {"email": "ghost@example.com"}, format="json")

        self.assertEqual(broken_hit.status_code, miss.status_code)
        self.assertEqual(broken_hit.json(), miss.json())


@override_settings(**PROD_EMAIL_SETTINGS)
class PasswordResetConfirmTokenTest(TestCase):
    """Complements PasswordResetRevokesSessionsTest in test_remember_me.py."""

    def setUp(self) -> None:
        self.settings_override = override_settings(REST_FRAMEWORK=_RELAXED_THROTTLES)
        self.settings_override.enable()
        api_settings.reload()
        self.original_throttle_rates = SimpleRateThrottle.THROTTLE_RATES
        SimpleRateThrottle.THROTTLE_RATES = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="reset@example.com", email="reset@example.com", password="oldpass123"
        )

    def tearDown(self) -> None:
        cache.clear()
        SimpleRateThrottle.THROTTLE_RATES = self.original_throttle_rates
        self.settings_override.disable()
        api_settings.reload()

    def _payload(self) -> dict:
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        return {
            "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
            "token": default_token_generator.make_token(self.user),
        }

    def test_tampered_token_is_rejected(self) -> None:
        body = {
            **self._payload(),
            "token": "not-a-real-token",
            "password": "brand-new-pass123",
            "confirm_password": "brand-new-pass123",
        }
        response: Any = self.client.post(
            "/api/auth/password-reset/confirm/", body, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_link_is_single_use(self) -> None:
        body = {
            **self._payload(),
            "password": "brand-new-pass123",
            "confirm_password": "brand-new-pass123",
        }
        first: Any = self.client.post(
            "/api/auth/password-reset/confirm/", body, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        cache.clear()
        replay: Any = self.client.post(
            "/api/auth/password-reset/confirm/", body, format="json"
        )
        self.assertEqual(replay.status_code, status.HTTP_400_BAD_REQUEST)
