import { describe, expect, it } from 'vitest'
import type { Store } from '@/types/store'
import { contrastRatio } from '@/utils/colorContrast'
import { buildStoreBranding } from '../useStoreBranding'

const storeWith = (primary: string): Store =>
  ({
    id: 1,
    name: 'Loja',
    slug: 'loja',
    whatsapp_phone: '',
    is_active: true,
    receipt_exchange_policy: '',
    receipt_paper_format: '80mm',
    theme: { primary },
  }) as Store

describe('buildStoreBranding', () => {
  it('uses neutral production fallbacks when no store branding has loaded', () => {
    const branding = buildStoreBranding(null)

    expect(branding.name).toBe('Sua loja')
    expect(branding.tagline).toBe('')
    expect(branding.theme).toEqual({
      primary: '#05050A',
      accent: '#111827',
      background: '#FAFAFA',
      surface: '#FFFFFF',
      text: '#05050A',
      muted: '#6B7280',
    })
    expect(Object.values(branding.theme)).not.toContain('#D81B60')
  })

  it('emits the safe storefront token set', () => {
    const vars = buildStoreBranding(null).cssVars
    for (const token of [
      '--store-bg',
      '--store-surface',
      '--store-text',
      '--store-text-muted',
      '--store-border',
      '--store-brand',
      '--store-brand-contrast',
      '--store-brand-strong',
      '--store-brand-soft',
      '--store-brand-on-light',
      '--store-brand-on-light-contrast',
      '--store-focus',
    ]) {
      expect(vars[token]).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('keeps a legible CTA foreground for a pale brand like #FFE600', () => {
    const vars = buildStoreBranding(storeWith('#FFE600')).cssVars
    // Solid CTA: near-black auto-foreground on the vivid brand fill.
    expect(vars['--store-brand']).toBe('#FFE600')
    expect(contrastRatio(vars['--store-brand-contrast']!, vars['--store-brand']!)).toBeGreaterThanOrEqual(4.5)
    // The `--store-primary` alias (used as accent text/border on the light
    // surface across legacy components) must itself clear AA on the surface.
    expect(contrastRatio(vars['--store-primary']!, vars['--store-surface']!)).toBeGreaterThanOrEqual(4.5)
    expect(vars['--store-primary']).toBe(vars['--store-brand-on-light'])
    // white text is hardcoded next to several `bg-[var(--store-primary)]`
    // chips -- that pairing must also pass.
    expect(contrastRatio('#FFFFFF', vars['--store-primary']!)).toBeGreaterThanOrEqual(4.5)
    // Selected chip: background is --store-brand-on-light, so its text must
    // be picked against that colour, not against the original --store-brand.
    expect(
      contrastRatio(vars['--store-brand-on-light-contrast']!, vars['--store-brand-on-light']!),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('gives a dark brand a light CTA foreground', () => {
    const vars = buildStoreBranding(storeWith('#0B1F3A')).cssVars
    expect(contrastRatio(vars['--store-brand-contrast']!, vars['--store-brand']!)).toBeGreaterThanOrEqual(4.5)
  })
})
