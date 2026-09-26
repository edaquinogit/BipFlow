"""bipdelivery.api.checks.check_production_email_config.

Guards the go-live gate that would have caught the 2026-09 password-reset
incident: an incomplete SMTP config must fail `manage.py check` / `migrate`
(and therefore the deploy) instead of 500-ing at send time.

Run with:
    pytest bipdelivery/tests/test_production_checks.py -v
"""

import os

import django
from django.test import SimpleTestCase, override_settings

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bipdelivery.core.settings")
django.setup()

from bipdelivery.api.checks import check_production_email_config  # noqa: E402

_COMPLETE = dict(
    IS_PRODUCTION=True,
    EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
    EMAIL_HOST="smtp.provider.example",
    EMAIL_HOST_USER="apikey",
    EMAIL_HOST_PASSWORD="s3cr3t",
    DEFAULT_FROM_EMAIL="no-reply@bipflow.com.br",
    FRONTEND_BASE_URL="https://bipflow.pages.dev",
)


def _ids(errors):
    return sorted(e.id for e in errors)


class ProductionEmailConfigCheckTest(SimpleTestCase):
    @override_settings(**_COMPLETE)
    def test_complete_production_config_passes(self) -> None:
        self.assertEqual(check_production_email_config(None), [])

    @override_settings(**{**_COMPLETE, "IS_PRODUCTION": False, "EMAIL_HOST": "localhost"})
    def test_non_production_is_a_noop(self) -> None:
        self.assertEqual(check_production_email_config(None), [])

    @override_settings(**{**_COMPLETE, "EMAIL_HOST": "localhost"})
    def test_placeholder_email_host_is_flagged(self) -> None:
        self.assertEqual(_ids(check_production_email_config(None)), ["bipflow.E001"])

    @override_settings(**{**_COMPLETE, "EMAIL_HOST_PASSWORD": ""})
    def test_missing_credential_is_flagged(self) -> None:
        self.assertEqual(_ids(check_production_email_config(None)), ["bipflow.E001"])

    @override_settings(**{**_COMPLETE, "EMAIL_BACKEND": "django.core.mail.backends.console.EmailBackend"})
    def test_non_delivering_backend_is_flagged(self) -> None:
        self.assertEqual(_ids(check_production_email_config(None)), ["bipflow.E001"])

    @override_settings(**{**_COMPLETE, "FRONTEND_BASE_URL": "http://bipflow.pages.dev"})
    def test_non_https_frontend_base_url_is_flagged(self) -> None:
        self.assertEqual(_ids(check_production_email_config(None)), ["bipflow.E002"])

    @override_settings(
        IS_PRODUCTION=True,
        EMAIL_BACKEND="",
        EMAIL_HOST="localhost",
        EMAIL_HOST_USER="",
        EMAIL_HOST_PASSWORD="",
        DEFAULT_FROM_EMAIL="no-reply@bipflow.local",
        FRONTEND_BASE_URL="http://127.0.0.1:5173",
    )
    def test_the_incident_config_is_fully_flagged(self) -> None:
        self.assertEqual(_ids(check_production_email_config(None)), ["bipflow.E001", "bipflow.E002"])
