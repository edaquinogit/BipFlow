/**
 * Etapa C1 of the PDV camera-scanner evolution (see
 * docs/architecture/pdv-camera-scanner-refinement.md), hardened by the
 * PDV/QR/payment evolution (see docs/architecture/pdv-qr-payment-evolution.md):
 * the QR Code printed on a product label doesn't encode the bare
 * `public_code` -- it encodes the full public storefront deep-link URL
 * (`build_product_deep_link_url()` in `bipdelivery/api/product_labels.py`),
 * so a generic customer camera lands on the product page. A camera-based
 * scan in the PDV decodes that same QR, so the raw decoded text is a URL,
 * not a code -- this extracts the trailing `/p/<code>` segment before
 * handing it to the by-code lookup (`ProductService.getByCode`).
 *
 * Every scan -- camera decode, USB HID reader, manual typing -- is untrusted
 * input. `parseScanPayload()` is the single normalisation/validation
 * chokepoint: it caps the length, rejects anything carrying control
 * characters, whitespace or a script/URL scheme, and only ever returns a
 * bare `public_code`-shaped token. Nothing downstream (the by-code request,
 * the cart) ever sees a raw URL, a `javascript:` string or an arbitrary blob.
 */

/** Hard ceiling on a scan payload. A product deep-link is well under 120
 * chars; a QR Code big enough to hold 512 chars is not one of ours. */
const MAX_RAW_LENGTH = 512;

/** Matches `build_product_deep_link_url()` exactly: `.../l/<slug>/p/<code>`.
 * `public_code` is auto-generated, uppercase alphanumeric, <= 12 chars
 * (bipdelivery/api/models.py); a little headroom is allowed. Requiring the
 * `/l/<slug>/` segment (not a bare `/p/<code>` anywhere in the path) keeps a
 * crafted URL from a stranger's host slightly harder to weaponise -- though
 * the by-code lookup is store-scoped server-side regardless. */
const DEEP_LINK_CODE_PATTERN = /\/l\/[^/]+\/p\/([A-Za-z0-9]{1,24})(?:[/?#].*)?$/i;

/** A bare token from a HID reader or manual typing: alphanumeric, optionally
 * with `-`/`_`/`.` separators (some SKUs use them). No spaces, no slashes. */
const BARE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** C0/C1 control characters, DEL, and any whitespace -- never part of a
 * code, and a common smuggling vector for log/render injection. */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007f-\u009f]/;

/** An executable/data scheme, or raw markup, we must never resolve or echo. */
const UNSAFE_SCHEME_PATTERN = /javascript:|vbscript:|data:|<|>/i;

export type ScanParseResult =
  | { ok: true; code: string }
  | { ok: false; reason: "empty" | "too_long" | "unsupported" };

/**
 * Normalise whatever a scan produced into the `public_code` the by-code
 * lookup expects, or reject it. A decoded deep-link URL yields its `/p/<code>`
 * segment; a bare code is returned as-is; anything else is `unsupported`.
 */
export function parseScanPayload(raw: unknown): ScanParseResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "unsupported" };
  }
  if (raw.length > MAX_RAW_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (CONTROL_OR_SPACE_PATTERN.test(trimmed) || UNSAFE_SCHEME_PATTERN.test(trimmed)) {
    return { ok: false, reason: "unsupported" };
  }

  const deepLink = trimmed.match(DEEP_LINK_CODE_PATTERN);
  if (deepLink?.[1]) {
    return { ok: true, code: deepLink[1] };
  }

  // A URL (ours with an unexpected shape, or a stranger's) that isn't a
  // product deep-link is not something the PDV can resolve.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.includes("/")) {
    return { ok: false, reason: "unsupported" };
  }

  if (BARE_CODE_PATTERN.test(trimmed)) {
    return { ok: true, code: trimmed };
  }

  return { ok: false, reason: "unsupported" };
}

/**
 * Back-compatible helper: returns just the resolved code, falling back to
 * the trimmed input when the payload isn't recognised (preserving the
 * pre-hardening behaviour for the manual/HID text path, which re-validates
 * server-side anyway). New code should prefer `parseScanPayload()`.
 */
export function extractPublicCodeFromScan(raw: string): string {
  const parsed = parseScanPayload(raw);
  if (parsed.ok) {
    return parsed.code;
  }
  return typeof raw === "string" ? raw.trim() : "";
}
