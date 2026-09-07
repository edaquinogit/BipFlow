"""
TOTP-based MFA helpers (Fase 3.1 of the auth-security plan): the short-lived
challenge token minted between password and second-factor verification, and
QR/provisioning-URI generation for the setup flow.

Uses Django's own signed-cookie-style signing (`django.core.signing`) for the
challenge token rather than minting a second JWT type -- it's a 5-minute,
single-purpose token that must NOT be usable as an API access token, and
reusing SimpleJWT here would risk exactly that confusion.
"""

from __future__ import annotations

import base64
import io
from typing import Optional

import pyotp
import qrcode
from django.core import signing

MFA_CHALLENGE_SALT = "bipflow-mfa-challenge"
MFA_CHALLENGE_MAX_AGE_SECONDS = 300

# Authenticator-app label for newly provisioned TOTP entries. Changing it does
# not affect already-enrolled users: verification uses only the shared secret,
# and existing authenticator entries keep whatever label they were created with.
ISSUER_NAME = "Bip Flow"


def build_mfa_challenge_token(user_id: int, remember_me: bool = False) -> str:
    return signing.dumps({"user_id": user_id, "remember_me": remember_me}, salt=MFA_CHALLENGE_SALT)


def read_mfa_challenge_payload(token: str) -> Optional[dict]:
    """Return the {user_id, remember_me} embedded in a challenge token, or None if invalid/expired."""
    try:
        return signing.loads(token, salt=MFA_CHALLENGE_SALT, max_age=MFA_CHALLENGE_MAX_AGE_SECONDS)
    except signing.BadSignature:
        return None


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp_code(secret: str, code: str) -> bool:
    if not code:
        return False
    totp = pyotp.TOTP(secret)
    # valid_window=1 tolerates one 30s step of clock drift either side.
    return totp.verify(code, valid_window=1)


def build_provisioning_uri(secret: str, account_email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_email, issuer_name=ISSUER_NAME)


def build_qr_code_data_uri(provisioning_uri: str) -> str:
    """Render the provisioning URI as a base64 PNG data URI for inline <img> use."""
    image = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
