import { describe, expect, it } from 'vitest'
import {
  AA_CONTRAST,
  AA_LARGE_CONTRAST,
  buildStorefrontColorTokens,
  contrastRatio,
  deriveBrandHover,
  deriveBrandSoft,
  deriveReadableBrandOnLight,
  hexToRgb,
  normalizeHex,
  pickForeground,
  relativeLuminance,
  rgbToHex,
} from '../colorContrast'

const SATURATED_LIGHT = '#38BDF8'
const SATURATED_DARK = '#1D4ED8'

describe('normalizeHex', () => {
  it('expands shorthand and upper-cases', () => {
    expect(normalizeHex('#fe0')).toBe('#FFEE00')
    expect(normalizeHex('abc')).toBe('#AABBCC')
  })

  it('keeps 6-digit hex and drops alpha', () => {
    expect(normalizeHex('#FFE600')).toBe('#FFE600')
    expect(normalizeHex('#11223344')).toBe('#112233')
  })

  it('returns null for invalid input', () => {
    expect(normalizeHex('not-a-color')).toBeNull()
    expect(normalizeHex('#12')).toBeNull()
    expect(normalizeHex('#1234567')).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })
})

describe('hexToRgb / rgbToHex', () => {
  it('round-trips a colour', () => {
    expect(hexToRgb('#FFE600')).toEqual({ r: 255, g: 230, b: 0 })
    expect(rgbToHex({ r: 255, g: 230, b: 0 })).toBe('#FFE600')
  })

  it('falls back safely on invalid input', () => {
    expect(hexToRgb('garbage', '#000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('clamps out-of-range channels', () => {
    expect(rgbToHex({ r: -10, g: 999, b: 128 })).toBe('#00FF80')
  })
})

describe('relativeLuminance', () => {
  it('anchors black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('rates a bright yellow as high luminance', () => {
    expect(relativeLuminance('#FFE600')).toBeGreaterThan(0.7)
  })
})

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      6,
    )
  })
})

describe('pickForeground', () => {
  it('chooses dark ink on a very light brand (#FFE600)', () => {
    const fg = pickForeground('#FFE600')
    expect(contrastRatio(fg, '#FFE600')).toBeGreaterThanOrEqual(AA_CONTRAST)
    expect(relativeLuminance(fg)).toBeLessThan(0.5)
  })

  it('chooses white on pure white input? no — chooses dark', () => {
    expect(relativeLuminance(pickForeground('#FFFFFF'))).toBeLessThan(0.5)
  })

  it('chooses light foreground on a dark brand', () => {
    const fg = pickForeground('#000000')
    expect(relativeLuminance(fg)).toBeGreaterThan(0.5)
    expect(contrastRatio(fg, '#000000')).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('chooses light foreground on a saturated dark blue', () => {
    expect(relativeLuminance(pickForeground(SATURATED_DARK))).toBeGreaterThan(0.5)
  })

  it('falls back to a safe surface for invalid input', () => {
    expect(relativeLuminance(pickForeground('#xyz'))).toBeLessThan(0.5)
  })
})

describe('deriveReadableBrandOnLight', () => {
  it('leaves an already-dark brand untouched', () => {
    expect(deriveReadableBrandOnLight('#111827')).toBe('#111827')
  })

  it('darkens #FFE600 until it passes AA on white', () => {
    const adjusted = deriveReadableBrandOnLight('#FFE600', '#FFFFFF')
    expect(contrastRatio(adjusted, '#FFFFFF')).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('darkens a saturated light blue until it passes AA', () => {
    const adjusted = deriveReadableBrandOnLight(SATURATED_LIGHT, '#FFFFFF')
    expect(contrastRatio(adjusted, '#FFFFFF')).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('can hit only the large-text bar when asked', () => {
    const adjusted = deriveReadableBrandOnLight('#FFE600', '#FFFFFF', AA_LARGE_CONTRAST)
    expect(contrastRatio(adjusted, '#FFFFFF')).toBeGreaterThanOrEqual(AA_LARGE_CONTRAST)
  })
})

describe('deriveBrandHover / deriveBrandSoft', () => {
  it('moves a light brand toward black and a dark brand toward white', () => {
    expect(relativeLuminance(deriveBrandHover('#FFE600'))).toBeLessThan(
      relativeLuminance('#FFE600'),
    )
    expect(relativeLuminance(deriveBrandHover('#111827'))).toBeGreaterThan(
      relativeLuminance('#111827'),
    )
  })

  it('keeps the soft tint close to the surface', () => {
    const soft = deriveBrandSoft('#FFE600', '#FFFFFF')
    expect(contrastRatio(soft, '#FFFFFF')).toBeLessThan(1.5)
  })
})

describe('buildStorefrontColorTokens', () => {
  it('keeps a light base and legible text for #FFE600 as brand', () => {
    const tokens = buildStorefrontColorTokens({ brand: '#FFE600' })

    expect(tokens.bg).toBe('#FAFAFA')
    expect(tokens.surface).toBe('#FFFFFF')
    expect(contrastRatio(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(AA_CONTRAST)
    // CTA: foreground on the raw brand must pass AA.
    expect(contrastRatio(tokens.brandContrast, tokens.brand)).toBeGreaterThanOrEqual(AA_CONTRAST)
    expect(relativeLuminance(tokens.brandContrast)).toBeLessThan(0.5)
    // Brand-as-text on a light surface must pass AA.
    expect(contrastRatio(tokens.brandOnLight, tokens.surface)).toBeGreaterThanOrEqual(AA_CONTRAST)
    // Focus ring must at least clear the non-text 3:1 bar.
    expect(contrastRatio(tokens.focus, tokens.surface)).toBeGreaterThanOrEqual(AA_LARGE_CONTRAST)
  })

  it('produces a light foreground for a dark brand', () => {
    const tokens = buildStorefrontColorTokens({ brand: '#050505' })
    expect(relativeLuminance(tokens.brandContrast)).toBeGreaterThan(0.5)
    expect(contrastRatio(tokens.brandContrast, tokens.brand)).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('handles pure white and pure black brands without throwing', () => {
    for (const brand of ['#FFFFFF', '#000000']) {
      const tokens = buildStorefrontColorTokens({ brand })
      expect(contrastRatio(tokens.brandContrast, tokens.brand)).toBeGreaterThanOrEqual(AA_LARGE_CONTRAST)
      expect(contrastRatio(tokens.brandOnLight, tokens.surface)).toBeGreaterThanOrEqual(AA_CONTRAST)
    }
  })

  it('falls back to safe values for an invalid hex brand', () => {
    const tokens = buildStorefrontColorTokens({ brand: '#zzz', background: 'oops', text: 'nope' })
    expect(tokens.bg).toBe('#FAFAFA')
    expect(tokens.surface).toBe('#FFFFFF')
    expect(tokens.brand).toBe('#111827')
    expect(contrastRatio(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('rejects a merchant text colour that would be illegible on the surface', () => {
    const tokens = buildStorefrontColorTokens({ text: '#EEEEEE', surface: '#FFFFFF' })
    expect(contrastRatio(tokens.text, tokens.surface)).toBeGreaterThanOrEqual(AA_CONTRAST)
  })

  it('accepts #777777 as a muted colour only if it clears the 3:1 bar', () => {
    const tokens = buildStorefrontColorTokens({ muted: '#777777', surface: '#FFFFFF' })
    expect(contrastRatio(tokens.textMuted, tokens.surface)).toBeGreaterThanOrEqual(AA_LARGE_CONTRAST)
  })

  // brandOnLightContrast is the foreground for text/icons drawn *on top of*
  // brandOnLight itself (e.g. the selected chip), not on top of the raw
  // brand -- brandContrast is picked against `brand` and is not guaranteed
  // to still pass once brandOnLight has darkened a pale/vivid brand for its
  // own AA pass against `surface`.
  describe('brandOnLightContrast', () => {
    it.each([
      ['a pale/vivid yellow', '#FFE600'],
      ['a dark colour', '#111827'],
      ['a light saturated colour', SATURATED_LIGHT],
      ['an intermediate grey', '#767676'],
    ])('passes AA against brandOnLight for %s', (_label, brand) => {
      const tokens = buildStorefrontColorTokens({ brand })
      expect(contrastRatio(tokens.brandOnLightContrast, tokens.brandOnLight)).toBeGreaterThanOrEqual(
        AA_CONTRAST,
      )
    })

    it('differs from brandContrast when brandOnLight had to darken a pale brand', () => {
      const tokens = buildStorefrontColorTokens({ brand: '#FFE600' })
      // brandOnLight is darkened well past the point where the foreground
      // picked for the original #FFE600 (near-black) still passes AA on it.
      expect(contrastRatio(tokens.brandContrast, tokens.brandOnLight)).toBeLessThan(AA_CONTRAST)
      expect(tokens.brandOnLightContrast).not.toBe(tokens.brandContrast)
    })
  })
})
