"""Deploy-time system checks for configuration that is safe to boot without but
unsafe to actually run in production.

Registered from :meth:`bipdelivery.api.apps.ApiConfig.ready`. These run on plain
``manage.py check`` and, crucially, on ``manage.py migrate`` -- which the Docker
entrypoint runs before gunicorn starts. An ``Error`` there aborts the deploy
(``set -e``) so the previous, working revision keeps serving instead of a build
that would 500 every password-reset request.
"""

from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, register

# Backends that "work" but never actually deliver mail off-box.
_NON_DELIVERING_BACKEND_SUFFIXES = (
    ".console.EmailBackend",
    ".dummy.EmailBackend",
    ".locmem.EmailBackend",
    ".filebased.EmailBackend",
)
# EMAIL_HOST values that mean "not configured" in a container with no local MTA.
_PLACEHOLDER_EMAIL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


def _is_missing(name: str, value: str) -> bool:
    value = (value or "").strip()
    if not value:
        return True
    if name == "EMAIL_BACKEND":
        return value.endswith(_NON_DELIVERING_BACKEND_SUFFIXES)
    if name == "EMAIL_HOST":
        return value.lower() in _PLACEHOLDER_EMAIL_HOSTS
    if name == "DEFAULT_FROM_EMAIL":
        return value.endswith(("bipflow.local", "@localhost", "example.com"))
    return False


@register("bipflow")
def check_production_email_config(app_configs, **kwargs):
    """Fail the deploy if production cannot actually deliver transactional email.

    An incomplete SMTP config lets the app boot but turns every password-reset
    request for a real account into an unhandled 500 at send time (the 2026-09
    incident). Outside production this is a no-op so local/CI runs are untouched.
    """
    if not getattr(settings, "IS_PRODUCTION", False):
        return []

    errors: list[Error] = []

    checked = (
        "EMAIL_BACKEND",
        "EMAIL_HOST",
        "EMAIL_HOST_USER",
        "EMAIL_HOST_PASSWORD",
        "DEFAULT_FROM_EMAIL",
    )
    missing = [name for name in checked if _is_missing(name, str(getattr(settings, name, "")))]
    if missing:
        errors.append(
            Error(
                "Transactional email is not deliverable in production: "
                f"{', '.join(missing)} unset or still on a dev placeholder.",
                hint=(
                    "Set these in the Render dashboard (they are sync:false in "
                    "render.yaml). Password-reset and verification email raise "
                    "500 at send time without them -- this is the 2026-09 incident."
                ),
                id="bipflow.E001",
            )
        )

    frontend_base_url = str(getattr(settings, "FRONTEND_BASE_URL", "") or "")
    if not frontend_base_url.startswith("https://"):
        errors.append(
            Error(
                "FRONTEND_BASE_URL must be an https:// URL in production "
                f"(got {frontend_base_url!r}).",
                hint="It is embedded verbatim in password-reset links.",
                id="bipflow.E002",
            )
        )

    return errors
