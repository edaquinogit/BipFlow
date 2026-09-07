import { computed, type ComputedRef, type Ref } from 'vue'
import type { Store, StoreStatus, StoreTheme } from '@/types/store'
import { buildStorefrontColorTokens, mix } from '@/utils/colorContrast'

const FALLBACK_LOGO_URL = '/brand-logo.png'

const DEFAULT_THEME: Required<Record<keyof StoreTheme, string>> = {
  primary: '#05050A',
  accent: '#111827',
  background: '#FAFAFA',
  surface: '#FFFFFF',
  text: '#05050A',
  muted: '#6B7280',
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export interface StoreBranding {
  name: string
  slug: string
  logoUrl: string
  tagline: string
  whatsappPhone: string
  isActive: boolean
  status: StoreStatus
  statusLabel: string
  theme: Required<Record<keyof StoreTheme, string>>
  cssVars: Record<string, string>
}

function sanitizeText(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim()
  return normalizedValue || fallback
}

function sanitizeThemeColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim()
  return normalizedValue && HEX_COLOR_PATTERN.test(normalizedValue) ? normalizedValue : fallback
}

export function buildStoreBranding(store: Store | null | undefined): StoreBranding {
  const theme = {
    primary: sanitizeThemeColor(store?.theme?.primary, DEFAULT_THEME.primary),
    accent: sanitizeThemeColor(store?.theme?.accent, DEFAULT_THEME.accent),
    background: sanitizeThemeColor(store?.theme?.background, DEFAULT_THEME.background),
    surface: sanitizeThemeColor(store?.theme?.surface, DEFAULT_THEME.surface),
    text: sanitizeThemeColor(store?.theme?.text, DEFAULT_THEME.text),
    muted: sanitizeThemeColor(store?.theme?.muted, DEFAULT_THEME.muted),
  }
  const isActive = store?.is_active ?? true
  const status = store?.status ?? (isActive ? 'active' : 'inactive')

  // Contrast-safe token set: background / surface / text always resolve to a
  // legible light base, and every brand-derived value is computed or checked
  // (see utils/colorContrast.ts) so a merchant colour can personalise actions
  // and accents but can never destroy legibility.
  const safe = buildStorefrontColorTokens({
    background: theme.background,
    surface: theme.surface,
    text: theme.text,
    muted: theme.muted,
    brand: theme.primary,
  })

  return {
    name: sanitizeText(store?.display_name, sanitizeText(store?.name, 'Sua loja')),
    slug: sanitizeText(store?.slug, ''),
    logoUrl: sanitizeText(store?.logo_url, FALLBACK_LOGO_URL),
    tagline: sanitizeText(store?.tagline, ''),
    whatsappPhone: sanitizeText(store?.whatsapp_phone, ''),
    isActive,
    status,
    statusLabel: status === 'active' ? 'Ativa' : 'Inativa',
    theme,
    cssVars: {
      // Safe foundation tokens (Ciclo 1) -- the storefront shell reads these.
      '--store-bg': safe.bg,
      '--store-surface': safe.surface,
      '--store-text': safe.text,
      '--store-text-muted': safe.textMuted,
      '--store-border': safe.border,
      '--store-brand': safe.brand,
      '--store-brand-contrast': safe.brandContrast,
      '--store-brand-strong': safe.brandStrong,
      '--store-brand-soft': safe.brandSoft,
      '--store-brand-ink': safe.brandInk,
      '--store-brand-on-light': safe.brandOnLight,
      '--store-brand-on-light-contrast': safe.brandOnLightContrast,
      '--store-focus': safe.focus,
      // Backwards-compatible aliases so existing storefront components
      // (ProductCard, CartDrawer, ...) inherit the safe palette unchanged.
      // These override the color-mix() derivations in storefront-theme.css.
      // NOTE: in this codebase `--store-primary` is used mostly as an accent
      // for *text / borders / rings on the light surface*, so it maps to the
      // AA-checked `brandOnLight`; the raw vivid brand stays available as
      // `--store-brand` for the solid primary button fill.
      '--store-primary': safe.brandOnLight,
      '--store-primary-hover': mix(safe.brandOnLight, '#000000', 0.12),
      '--store-primary-soft': safe.brandSoft,
      '--store-accent': theme.accent,
      '--store-background': safe.bg,
      '--store-muted': safe.textMuted,
    },
  }
}

export function useStoreBranding(store: Ref<Store | null> | ComputedRef<Store | null>) {
  return computed(() => buildStoreBranding(store.value))
}
