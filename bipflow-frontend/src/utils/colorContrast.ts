/**
 * Pure, deterministic colour maths for the storefront theme engine.
 *
 * A merchant only ever picks a small set of raw hex colours. This module
 * turns those into a palette that is *guaranteed* legible: it never trusts
 * `color-mix()` for a contrast promise, it computes WCAG relative luminance
 * and contrast ratios itself and derives foregrounds / adjusted brand shades
 * from those numbers.
 *
 * Nothing here touches Vue reactivity, the DOM or the network, so the
 * functions are named plainly (not `use*`) and are trivially unit-testable.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** WCAG 2.1 AA threshold for normal-size body text. */
export const AA_CONTRAST = 4.5
/** WCAG 2.1 AA threshold for large text and non-text UI (borders, focus rings, icons). */
export const AA_LARGE_CONTRAST = 3

/** Safe neutral fallbacks, mirrored from useStoreBranding's DEFAULT_THEME. */
export const SAFE_LIGHT = '#FAFAFA'
export const SAFE_SURFACE = '#FFFFFF'
export const SAFE_DARK_INK = '#0A0A0A'
export const SAFE_BRAND = '#111827'

const SHORT_HEX = /^#?([0-9a-fA-F]{3})$/
const LONG_HEX = /^#?([0-9a-fA-F]{6})$/
const LONG_HEX_ALPHA = /^#?([0-9a-fA-F]{8})$/

/**
 * Normalise any accepted hex form to `#rrggbb` upper-case, dropping an alpha
 * channel. Returns `null` for anything that is not a valid hex colour so the
 * caller can fall back to a safe value.
 */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  const short = SHORT_HEX.exec(trimmed)?.[1]
  if (short) {
    const [r, g, b] = [short[0], short[1], short[2]]
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }

  const long = LONG_HEX.exec(trimmed)?.[1]
  if (long) {
    return `#${long}`.toUpperCase()
  }

  const alpha = LONG_HEX_ALPHA.exec(trimmed)?.[1]
  if (alpha) {
    return `#${alpha.slice(0, 6)}`.toUpperCase()
  }

  return null
}

/** Parse a hex colour to 0-255 RGB channels. Invalid input falls back to `fallback`. */
export function hexToRgb(value: string | null | undefined, fallback = SAFE_BRAND): Rgb {
  const normalized = normalizeHex(value) ?? normalizeHex(fallback) ?? '#111827'
  const int = Number.parseInt(normalized.slice(1), 16)
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  }
}

function clampChannel(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel)))
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number) => clampChannel(channel).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

/** sRGB channel -> linear-light value, per WCAG 2.1. */
function channelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance in the 0 (black) .. 1 (white) range. */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? hexToRgb(color) : color
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  )
}

/** WCAG contrast ratio between two colours, from 1:1 to 21:1. */
export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const lightest = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darkest = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lightest + 0.05) / (darkest + 0.05)
}

/**
 * Pick the foreground (near-black or white) that reads best on `background`.
 * Deterministic: compares real contrast ratios rather than a luminance cutoff,
 * so borderline mid-tones resolve to whichever actually wins.
 */
export function pickForeground(
  background: string | null | undefined,
  options: { dark?: string; light?: string } = {},
): string {
  const dark = normalizeHex(options.dark) ?? SAFE_DARK_INK
  const light = normalizeHex(options.light) ?? SAFE_SURFACE
  const bg = normalizeHex(background) ?? SAFE_SURFACE
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light
}

function mixChannel(from: number, to: number, weight: number): number {
  return from + (to - from) * weight
}

/** Blend two colours in sRGB space. `weight` is how much of `to` to apply (0..1). */
export function mix(from: string, to: string, weight: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const w = Math.max(0, Math.min(1, weight))
  return rgbToHex({
    r: mixChannel(a.r, b.r, w),
    g: mixChannel(a.g, b.g, w),
    b: mixChannel(a.b, b.b, w),
  })
}

/**
 * A hover shade for a solid brand button: nudge toward black for light brands,
 * toward white for dark brands, so the affordance is visible either way.
 */
export function deriveBrandHover(brand: string): string {
  const safeBrand = normalizeHex(brand) ?? SAFE_BRAND
  return relativeLuminance(safeBrand) > 0.5
    ? mix(safeBrand, '#000000', 0.12)
    : mix(safeBrand, '#FFFFFF', 0.14)
}

/**
 * A soft tint of the brand for hover backgrounds / chips, always sitting on
 * `surface`. Deterministic 12% blend toward the surface colour.
 */
export function deriveBrandSoft(brand: string, surface: string = SAFE_SURFACE): string {
  const safeBrand = normalizeHex(brand) ?? SAFE_BRAND
  const safeSurface = normalizeHex(surface) ?? SAFE_SURFACE
  return mix(safeSurface, safeBrand, 0.12)
}

/**
 * The brand colour is often used as *text* or an icon on a light surface
 * (category eyebrow, "Detalhe ->", price accents). A pale or vivid brand
 * (#FFE600, #38BDF8) would fail AA there, so darken it stepwise toward black
 * until it clears the target ratio against `surface`. Returns the first shade
 * that passes; if even black would not pass (impossible on a light surface)
 * it returns the darkest attempt.
 */
export function deriveReadableBrandOnLight(
  brand: string,
  surface: string = SAFE_SURFACE,
  targetRatio: number = AA_CONTRAST,
): string {
  const safeSurface = normalizeHex(surface) ?? SAFE_SURFACE
  let candidate = normalizeHex(brand) ?? SAFE_BRAND

  if (contrastRatio(candidate, safeSurface) >= targetRatio) {
    return candidate
  }

  for (let step = 1; step <= 20; step += 1) {
    candidate = mix(candidate, '#000000', 0.1)
    if (contrastRatio(candidate, safeSurface) >= targetRatio) {
      return candidate
    }
  }

  return candidate
}

export interface StorefrontColorTokens {
  bg: string
  surface: string
  text: string
  textMuted: string
  border: string
  brand: string
  brandContrast: string
  brandStrong: string
  brandSoft: string
  brandInk: string
  brandOnLight: string
  /**
   * Foreground for text/icons placed *on top of* a `brandOnLight` fill
   * (e.g. a selected chip). `brandOnLight` is brand darkened to pass AA
   * against `surface` -- a different colour from `brand` itself -- so
   * `brandContrast` (picked against the original `brand`) is not
   * guaranteed to still pass against it. This token is picked against
   * `brandOnLight` directly.
   */
  brandOnLightContrast: string
  focus: string
}

export interface RawStoreColors {
  background?: string | null
  surface?: string | null
  text?: string | null
  muted?: string | null
  /** Merchant-picked primary / brand colour. */
  brand?: string | null
}

/**
 * Turn the raw merchant colours into the full, contrast-safe token set the
 * storefront CSS consumes. Background / surface / text always resolve to a
 * light, legible base; only the brand colour personalises actions and accents,
 * and every brand-derived token is checked or computed, never assumed.
 */
export function buildStorefrontColorTokens(raw: RawStoreColors): StorefrontColorTokens {
  const bg = normalizeHex(raw.background) ?? SAFE_LIGHT
  const surface = normalizeHex(raw.surface) ?? SAFE_SURFACE
  const requestedText = normalizeHex(raw.text) ?? SAFE_DARK_INK
  // Never let a bright "text" colour break body legibility on the surface.
  const text =
    contrastRatio(requestedText, surface) >= AA_CONTRAST ? requestedText : SAFE_DARK_INK

  const requestedMuted = normalizeHex(raw.muted) ?? '#6B7280'
  const textMuted =
    contrastRatio(requestedMuted, surface) >= AA_LARGE_CONTRAST ? requestedMuted : '#5B6370'

  const brand = normalizeHex(raw.brand) ?? SAFE_BRAND
  const brandContrast = pickForeground(brand)
  const brandOnLight = deriveReadableBrandOnLight(brand, surface)
  const brandOnLightContrast = pickForeground(brandOnLight)
  const border = mix(surface, text, 0.14)
  const focus = deriveReadableBrandOnLight(brand, surface, AA_LARGE_CONTRAST)

  return {
    bg,
    surface,
    text,
    textMuted,
    border,
    brand,
    brandContrast,
    brandStrong: deriveBrandHover(brand),
    brandSoft: deriveBrandSoft(brand, surface),
    brandInk: brandOnLight,
    brandOnLight,
    brandOnLightContrast,
    focus,
  }
}
