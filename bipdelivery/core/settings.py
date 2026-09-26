import logging
import os
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

# ------------------------------------------------------------------------------
# ðŸ›°ï¸ BASE DIRECTORY & PATHS
# ------------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

# Load documented root .env first, then allow a backend-local .env for developers
# who prefer keeping Django-only overrides beside manage.py.
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")

# Opt-in only: DJANGO_ENV_FILE points at a named profile (e.g. .env.e2e, the
# local Cypress throttle profile mirroring .github/workflows/ci.yml's
# frontend-e2e job) instead of editing the developer's own .env by hand.
# override=True since this is a deliberate, explicit request -- it should
# win over whatever the regular .env already set, not be silently shadowed
# by it. Never set in production (Render injects real env vars directly;
# see render.yaml), so this block is inert there.
_env_profile = os.environ.get("DJANGO_ENV_FILE")
if _env_profile:
    load_dotenv(PROJECT_ROOT / _env_profile, override=True)
    load_dotenv(BASE_DIR / _env_profile, override=True)

# ------------------------------------------------------------------------------
# ðŸ”‘ SECURITY & ENVIRONMENT
# ------------------------------------------------------------------------------


def get_bool_env(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_env_value(key: str, default: str) -> str:
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip() or default


def get_env_list(key: str, default: list[str] | None = None) -> list[str]:
    value = os.environ.get(key)
    if value is None:
        return list(default or [])

    return [item.strip() for item in value.split(",") if item.strip()]


def get_int_env(key: str, default: int) -> int:
    value = os.environ.get(key)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError as exc:
        raise ImproperlyConfigured(f"{key} must be an integer.") from exc


def is_test_mode() -> bool:
    return bool(os.environ.get("PYTEST_CURRENT_TEST") or any("pytest" in arg for arg in sys.argv))


ENVIRONMENT = os.environ.get("DJANGO_ENV", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"
IS_TEST = is_test_mode()


def get_env_or_raise(key: str) -> str:
    value = os.environ.get(key)
    if value:
        return value

    if not IS_PRODUCTION:
        # Keep local/test fallback long enough for HS256 recommendations.
        return "django-insecure-local-key-for-bipflow-tests-2026"

    raise ImproperlyConfigured(f"{key} must be set as an environment variable.")


DEBUG = get_bool_env("DJANGO_DEBUG", not IS_PRODUCTION)

if IS_PRODUCTION and DEBUG:
    raise ImproperlyConfigured("DJANGO_DEBUG must be False in production.")

SECRET_KEY = get_env_or_raise("DJANGO_SECRET_KEY")
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://127.0.0.1:5173").rstrip("/")

ALLOWED_HOSTS = get_env_list("DJANGO_ALLOWED_HOSTS")

if not ALLOWED_HOSTS:
    if not IS_PRODUCTION:
        # Wildcard, not just 127.0.0.1/localhost: the Vite dev proxy (see
        # vite.config.ts) forwards requests with their original Host header
        # unchanged, so opening the frontend from a phone on the same Wi-Fi
        # (via Vite's --host 0.0.0.0 LAN address) makes Django see that LAN
        # IP as the Host -- which can't be predicted/hardcoded here. Fine in
        # dev only; production still requires an explicit, validated list.
        ALLOWED_HOSTS = ["*"]
    else:
        raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be defined in production.")

# ------------------------------------------------------------------------------
# ðŸ“¦ APPS CONFIGURATION (Segregated for Clarity)
# ------------------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
    "django_filters",
    # 'rest_framework_simplejwt',  # JWT auth is configured in REST_FRAMEWORK settings, not as installed app
    "rest_framework_simplejwt.token_blacklist",  # Needed for its OutstandingToken/BlacklistedToken models (logout revocation)
]

LOCAL_APPS = [
    "bipdelivery.api.apps.ApiConfig",
    "bipdelivery.core",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ------------------------------------------------------------------------------
# ðŸ›¡ï¸ MIDDLEWARE (Security Order is Critical)
# ------------------------------------------------------------------------------
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # ðŸš€ Must be first for CORS preflight
    "bipdelivery.core.middleware.CORSMediaMiddleware",  # ðŸ–¼ï¸ CORS for media files
    "django.middleware.security.SecurityMiddleware",
    "bipdelivery.core.middleware.GlobalExceptionMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "bipdelivery.core.urls"
WSGI_APPLICATION = "bipdelivery.core.wsgi.application"

# ------------------------------------------------------------------------------
# ðŸŽ¨ TEMPLATE ENGINE (Fixes admin.E403 Error)
# ------------------------------------------------------------------------------
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ------------------------------------------------------------------------------
# ðŸ“Š DATABASE & AUTHENTICATION
# ------------------------------------------------------------------------------

logger = logging.getLogger(__name__)

# DATABASE_URL query parameters are parsed against this strict allowlist -- only
# these two are forwarded to psycopg. Everything else (connect_timeout,
# application_name, options, sslrootcert, ...) is ignored with a warning so a
# provider that later appends a parameter to the URL it hands out cannot crash
# the container. connect_timeout in particular stays owned by
# DATABASE_CONNECT_TIMEOUT (see below) and is never taken from the URL.
_ALLOWED_DB_URL_QUERY_PARAMS = frozenset({"sslmode", "channel_binding"})

# libpq's documented value sets. We validate but never rewrite the operator's
# choice (no silent prefer -> require or require -> verify-full promotion).
_VALID_SSLMODES = frozenset(
    {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
)
_VALID_CHANNEL_BINDING = frozenset({"disable", "prefer", "require"})


def build_db_url_query_options(query: str) -> dict:
    """Extract the allowlisted psycopg OPTIONS from a DATABASE_URL query string.

    parse_qsl (not parse_qs) so duplicate keys stay visible as separate pairs
    and can be rejected. keep_blank_values=False so ``?sslmode=`` is dropped
    rather than forwarded as an empty string.
    """
    options: dict[str, str] = {}

    for key, value in parse_qsl(query, keep_blank_values=False):
        if key not in _ALLOWED_DB_URL_QUERY_PARAMS:
            # Never log the value -- only the parameter name is guaranteed
            # non-sensitive.
            logger.warning(
                "Ignoring unsupported DATABASE_URL query parameter %r", key
            )
            continue
        if key in options:
            raise ImproperlyConfigured(
                f"DATABASE_URL query parameter {key!r} is set more than once."
            )
        options[key] = value

    sslmode = options.get("sslmode")
    if sslmode is not None and sslmode not in _VALID_SSLMODES:
        raise ImproperlyConfigured(
            f"DATABASE_URL sslmode {sslmode!r} is not one of "
            f"{sorted(_VALID_SSLMODES)}."
        )

    channel_binding = options.get("channel_binding")
    if channel_binding is not None and channel_binding not in _VALID_CHANNEL_BINDING:
        raise ImproperlyConfigured(
            f"DATABASE_URL channel_binding {channel_binding!r} is not one of "
            f"{sorted(_VALID_CHANNEL_BINDING)}."
        )

    return options


def build_database_config() -> dict:
    database_url = os.environ.get("DATABASE_URL", "").strip()

    if not database_url:
        return {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": BASE_DIR / "db.sqlite3",
            }
        }

    parsed_url = urlparse(database_url)
    scheme = parsed_url.scheme.lower()

    if scheme not in {"postgres", "postgresql"}:
        raise ImproperlyConfigured("DATABASE_URL must use postgres:// or postgresql://.")

    database_name = unquote(parsed_url.path.lstrip("/"))
    if not database_name:
        raise ImproperlyConfigured("DATABASE_URL must include a database name.")

    # libpq reads a connect_timeout of 0 or a negative number as "wait
    # indefinitely", which would silently undo the bound we want here, so
    # reject it explicitly rather than relying on the generic int parser
    # (get_int_env is shared with settings that legitimately allow 0).
    database_connect_timeout = get_int_env("DATABASE_CONNECT_TIMEOUT", 10)
    if database_connect_timeout <= 0:
        raise ImproperlyConfigured("DATABASE_CONNECT_TIMEOUT must be greater than 0.")

    # The allowlist in build_db_url_query_options() only ever yields sslmode /
    # channel_binding, so a URL-supplied connect_timeout is dropped there and
    # DATABASE_CONNECT_TIMEOUT stays the single authority for it. Merging URL
    # options last is belt-and-braces on top of that.
    options = {
        "connect_timeout": database_connect_timeout,
        **build_db_url_query_options(parsed_url.query),
    }

    return {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": database_name,
            "USER": unquote(parsed_url.username or ""),
            "PASSWORD": unquote(parsed_url.password or ""),
            "HOST": parsed_url.hostname or "localhost",
            "PORT": str(parsed_url.port or 5432),
            "CONN_MAX_AGE": get_int_env("DATABASE_CONN_MAX_AGE", 60),
            # Persistent connections (CONN_MAX_AGE > 0) can go stale while the
            # managed Postgres (Neon free tier) auto-suspends or a NAT/pooler
            # drops an idle socket -- the next request that reuses one then
            # fails. CONN_HEALTH_CHECKS makes Django ping the connection once
            # per request when reusing it and reconnect transparently if it's
            # dead. The ping only runs while a real request is being served,
            # so it adds no background traffic and never keeps Postgres awake.
            "CONN_HEALTH_CHECKS": True,
            # OPTIONS is passed straight through to psycopg. connect_timeout
            # (from DATABASE_CONNECT_TIMEOUT) bounds the boot-time wait when the
            # DB host is unreachable -- without it libpq blocks for the OS TCP
            # timeout (minutes) and hangs the container (migrate runs before
            # gunicorn). sslmode / channel_binding, when present in
            # DATABASE_URL, are forwarded here after allowlist validation.
            "OPTIONS": options,
        }
    }


DATABASES = build_database_config()

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ------------------------------------------------------------------------------
# ðŸŒ INTERNATIONALIZATION
# ------------------------------------------------------------------------------
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

# ------------------------------------------------------------------------------
# ðŸ–¼ï¸ STATIC & MEDIA ASSETS (BipFlow Assets Protocol)
# ------------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
LOGS_ROOT = BASE_DIR / "logs"

# Automatic directory creation for assets and runtime logs
for path in [STATIC_ROOT, MEDIA_ROOT, LOGS_ROOT]:
    os.makedirs(path, exist_ok=True)

# ------------------------------------------------------------------------------
# ☁️ MEDIA STORAGE (Cloudflare R2 / any S3-compatible backend)
# ------------------------------------------------------------------------------
# Local disk (MEDIA_ROOT above) is ephemeral on redeploy -- production must
# point at R2 so uploads (store-scoped product images) survive. Dev/test keep
# using disk storage untouched when these vars are absent.
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "").strip()
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "").strip()
# Custom domain proxied through Cloudflare (e.g. media.bipflow.com.br) so
# MEDIA_URL is stable and cacheable instead of the raw r2.cloudflarestorage.com host.
R2_PUBLIC_DOMAIN = os.environ.get("R2_PUBLIC_DOMAIN", "").strip()

USE_R2_STORAGE = bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME)

if IS_PRODUCTION and not USE_R2_STORAGE:
    raise ImproperlyConfigured(
        "R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME must be set in "
        "production -- disk media does not survive a redeploy."
    )

if USE_R2_STORAGE:
    AWS_ACCESS_KEY_ID = R2_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = R2_SECRET_ACCESS_KEY
    AWS_STORAGE_BUCKET_NAME = R2_BUCKET_NAME
    AWS_S3_ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    AWS_S3_REGION_NAME = "auto"
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_S3_SIGNATURE_VERSION = "s3v4"
    AWS_DEFAULT_ACL = None  # R2 does not support canned ACLs
    AWS_QUERYSTRING_AUTH = False  # serve public URLs, no signed query params
    AWS_S3_FILE_OVERWRITE = False  # keep Django's -suffix-on-collision behaviour

    if R2_PUBLIC_DOMAIN:
        AWS_S3_CUSTOM_DOMAIN = R2_PUBLIC_DOMAIN
        MEDIA_URL = f"https://{R2_PUBLIC_DOMAIN}/"
    else:
        MEDIA_URL = f"{AWS_S3_ENDPOINT_URL}/{R2_BUCKET_NAME}/"

    STORAGES = {
        "default": {"BACKEND": "storages.backends.s3.S3Storage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
else:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

# ------------------------------------------------------------------------------
# ðŸ”’ CORS & DRF SECURITY
# ------------------------------------------------------------------------------
# Parse CORS allowed origins from environment or use sensible defaults
if DEBUG:
    # In development, allow localhost and common dev ports
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:5173",  # Vite dev server
        "http://localhost:5174",  # Alternative Vite dev port
        "http://localhost:3000",  # Alternative dev port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
        "http://localhost:8000",  # Django dev server
        "http://127.0.0.1:8000",
    ]
else:
    CORS_ALLOWED_ORIGINS = get_env_list("CORS_ALLOWED_ORIGINS")

CSRF_TRUSTED_ORIGINS = get_env_list("CSRF_TRUSTED_ORIGINS")

CORS_ALLOW_CREDENTIALS = True
# Browsers hide non-safelisted response headers from cross-origin frontend
# code unless the API explicitly exposes them. DRF uses Retry-After on 429
# responses and the login UI reads it to show the real wait window.
CORS_EXPOSE_HEADERS = ["Retry-After"]
# The dashboard's store switcher sends this on every request (see
# store_scope.resolve_request_store) -- without it in the allowlist, the
# browser's CORS preflight rejects every call that carries it, including
# login itself, before it ever reaches Django.
CORS_ALLOW_HEADERS = [*default_headers, "x-store-slug"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Cookies/redirects are only forced in production: the proxy must already send
# X-Forwarded-Proto (see SECURE_PROXY_SSL_HEADER above) or this redirect loops.
# Verify in staging with the real proxy config before relying on this in prod.
if IS_PRODUCTION:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    # Docker healthchecks hit the backend container directly over plain HTTP
    # (no reverse proxy, no X-Forwarded-Proto) -- without this exemption
    # SECURE_SSL_REDIRECT 302s them to https on a port gunicorn doesn't
    # terminate TLS on, and the healthcheck times out forever.
    SECURE_REDIRECT_EXEMPT = [r"^healthz/?$"]
    # HSTS tells the browser to *refuse* plain HTTP on future visits -- a
    # commitment it caches and can't be revoked once made. Default max-age
    # is deliberately 1 hour, not the textbook 1 year: shipping a long value
    # against an unproven HTTPS/proxy setup risks a hard, unrecoverable
    # outage if the cert/proxy config turns out to be wrong. Ramp plan: run
    # at the 1h default for a few days, then raise SECURE_HSTS_SECONDS to
    # 31536000 (1 year) once confirmed stable, and only then consider
    # SECURE_HSTS_PRELOAD=True (near-irreversible, requires submitting the
    # domain to hstspreload.org).
    SECURE_HSTS_SECONDS = get_int_env("SECURE_HSTS_SECONDS", 3600)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = get_bool_env("SECURE_HSTS_INCLUDE_SUBDOMAINS", True)
    SECURE_HSTS_PRELOAD = get_bool_env("SECURE_HSTS_PRELOAD", False)

# Default deploy target is one origin (VM + Nginx proxying /api and /admin),
# where the refresh-token cookie can stay SameSite=Strict -- the strongest
# setting, since the browser never needs to send it cross-site at all. Split
# hosting (e.g. frontend on Cloudflare Pages, backend on Render, different
# domains) needs SameSite=None or the browser drops the cookie on every
# cross-origin request, breaking login/refresh entirely. Opt-in only, and
# only meaningful over HTTPS -- see _set_refresh_cookie in api/views.py.
BIPFLOW_CROSS_ORIGIN_COOKIES = get_bool_env("BIPFLOW_CROSS_ORIGIN_COOKIES", False)
REFRESH_COOKIE_SAMESITE = "None" if BIPFLOW_CROSS_ORIGIN_COOKIES else "Strict"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",  # ðŸ"' Allow public read access by default
    ],
    "DEFAULT_PAGINATION_CLASS": "bipdelivery.api.pagination.StandardPagination",
    "PAGE_SIZE": 12,
    "DEFAULT_THROTTLE_RATES": {
        "anon": get_env_value("BIPFLOW_THROTTLE_ANON", "20/hour"),
        "user": get_env_value("BIPFLOW_THROTTLE_USER", "100/hour"),
        "product_list": get_env_value("BIPFLOW_THROTTLE_PRODUCT_LIST", "500/hour"),
        "auth_ip": get_env_value("BIPFLOW_THROTTLE_AUTH_IP", "10/minute"),
        "checkout_ip": get_env_value("BIPFLOW_THROTTLE_CHECKOUT_IP", "5/minute"),
        "checkout_phone": get_env_value("BIPFLOW_THROTTLE_CHECKOUT_PHONE", "3/hour"),
        "bot_message_ip": get_env_value("BIPFLOW_THROTTLE_BOT_MESSAGE_IP", "30/minute"),
        "feedback_ip": get_env_value("BIPFLOW_THROTTLE_FEEDBACK_IP", "10/hour"),
        "auth_login_identity": get_env_value("BIPFLOW_THROTTLE_AUTH_LOGIN_IDENTITY", "5/minute"),
        "auth_register_identity": get_env_value(
            "BIPFLOW_THROTTLE_AUTH_REGISTER_IDENTITY", "3/hour"
        ),
        "auth_password_reset_identity": get_env_value(
            "BIPFLOW_THROTTLE_AUTH_PASSWORD_RESET_IDENTITY", "3/hour"
        ),
        "auth_password_reset_confirm_identity": get_env_value(
            "BIPFLOW_THROTTLE_AUTH_PASSWORD_RESET_CONFIRM_IDENTITY", "5/hour"
        ),
        "auth_token_refresh_ip": get_env_value(
            "BIPFLOW_THROTTLE_AUTH_TOKEN_REFRESH_IP", "30/minute"
        ),
        "auth_token_refresh_identity": get_env_value(
            "BIPFLOW_THROTTLE_AUTH_TOKEN_REFRESH_IDENTITY", "10/minute"
        ),
        "mfa_verify_ip": get_env_value("BIPFLOW_THROTTLE_MFA_VERIFY_IP", "10/minute"),
        "mfa_verify_identity": get_env_value("BIPFLOW_THROTTLE_MFA_VERIFY_IDENTITY", "10/minute"),
        "pdv_receipt_email": get_env_value("BIPFLOW_THROTTLE_PDV_RECEIPT_EMAIL", "10/hour"),
        "admin_login_ip": get_env_value("BIPFLOW_THROTTLE_ADMIN_LOGIN_IP", "5/minute"),
        "admin_login_identity": get_env_value("BIPFLOW_THROTTLE_ADMIN_LOGIN_IDENTITY", "5/minute"),
    },
}

# Gates the MFA requirement on the Django admin login (see api/admin_auth.py).
# A confirmed TOTPDevice is ALWAYS required regardless of this flag -- it
# only controls whether staff *without* MFA configured yet can still log in.
# Deliberately NOT tied to IS_PRODUCTION and defaults to False: flipping it
# on the same deploy that introduces this code would lock out any staff
# account (including the bootstrap admin from docker/backend-entrypoint.sh)
# that hasn't set up MFA yet. Turn on only after confirming every staff/
# superuser account has MFA configured (see the list_staff_without_mfa
# management command).
ADMIN_MFA_ENFORCED = get_bool_env("DJANGO_ADMIN_MFA_ENFORCED", False)

# Optional dedicated key for encrypting TOTP secrets at rest (api/crypto.py).
# Unset by default -- crypto.py falls back to a key derived from SECRET_KEY,
# same as before this setting existed. See crypto.py's module docstring for
# the trade-off and docs/admin-mfa-runbook.md-adjacent rotation notes before
# setting this on a deployment that may already have confirmed TOTPDevice
# rows (run `manage.py rotate_totp_encryption_key` first in that case).
TOTP_ENCRYPTION_KEY = os.environ.get("TOTP_ENCRYPTION_KEY", "").strip()

# ðŸ›°ï¸ JWT CONFIGURATION (Token Standards)
# ------------------------------------------------------------------------------
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# "Lembrar-me" (Fase 3.3): when checked at login, the refresh cookie/token
# get this longer lifetime instead of SIMPLE_JWT's default, and the cookie
# itself becomes persistent (Max-Age set) instead of a session cookie that
# dies when the browser closes. Unchecked is the more secure default.
REMEMBER_ME_REFRESH_TOKEN_LIFETIME = timedelta(days=30)

# Cloudflare Turnstile: conditional CAPTCHA after repeated login failures
# (Fase 2.3). Dev/test default is Cloudflare's own published "always passes"
# test secret -- production MUST set a real TURNSTILE_SECRET_KEY, otherwise
# anyone who crosses the failure threshold is locked out until it's set
# (fails closed, not silently disabled).
TURNSTILE_SECRET_KEY = os.environ.get(
    "TURNSTILE_SECRET_KEY",
    "" if IS_PRODUCTION else "1x0000000000000000000000000000000AA",
)
LOGIN_CAPTCHA_FAILURE_THRESHOLD = get_int_env("LOGIN_CAPTCHA_FAILURE_THRESHOLD", 4)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ------------------------------------------------------------------------------
# EMAIL DELIVERY / ACCOUNT VERIFICATION
# ------------------------------------------------------------------------------
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend" if not IS_PRODUCTION else ""
)
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "1025"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = get_bool_env("EMAIL_USE_TLS", False)
EMAIL_USE_SSL = get_bool_env("EMAIL_USE_SSL", False)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "no-reply@bipflow.local")

# send_mail() has no timeout of its own: a stuck SMTP handshake would pin the
# gunicorn worker until the platform reaps it. Bound every connection attempt
# so the password-reset request fails fast and predictably instead.
EMAIL_TIMEOUT = get_int_env("EMAIL_TIMEOUT", 10)

# STARTTLS and implicit TLS are mutually exclusive. Django's SMTP backend only
# rejects the combination lazily on the first send (i.e. as a runtime 500 on
# the password-reset path); promote it to a boot-time failure.
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured(
        "EMAIL_USE_TLS and EMAIL_USE_SSL are mutually exclusive -- enable only one."
    )

# Completeness of the production SMTP config (and the https FRONTEND_BASE_URL
# that ends up inside reset links) is enforced by the registered deploy check
# bipdelivery.api.checks.check_production_email_config, so an incomplete config
# fails `manage.py check` / the release phase instead of 500-ing at send time.

# ------------------------------------------------------------------------------
# ORDER CHECKOUT / WHATSAPP
# ------------------------------------------------------------------------------
WHATSAPP_ORDER_PHONE = os.environ.get("WHATSAPP_ORDER_PHONE", "").strip()
ORDER_DELIVERY_FEE = Decimal(os.environ.get("ORDER_DELIVERY_FEE", "12.00"))

# ------------------------------------------------------------------------------

# ─────────────────────────────────────────────────────────────────────────
# 🕐 CACHE CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────
CACHE_URL = os.environ.get("CACHE_URL", "").strip()

if CACHE_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": CACHE_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
            },
            "TIMEOUT": 300,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "bipflow-cache",
            "TIMEOUT": 300,
            "OPTIONS": {
                "MAX_ENTRIES": 10000,
            },
        }
    }

# ------------------------------------------------------------------------------
# 📝 LOGGING CONFIGURATION
# ------------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "level": "INFO",
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
        "file": {
            "level": "INFO",
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOGS_ROOT / "django.log",
            "maxBytes": 1024 * 1024 * 5,  # 5 MB
            "backupCount": 5,
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console", "file"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console", "file"],
            "level": "INFO",
            "propagate": False,
        },
        "bipdelivery": {
            "handlers": ["console", "file"],
            "level": "DEBUG" if not IS_PRODUCTION else "INFO",
            "propagate": False,
        },
    },
}
