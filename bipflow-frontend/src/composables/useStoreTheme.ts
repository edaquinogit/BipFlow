import { computed, type ComputedRef, type Ref } from 'vue'
import type { Store, StorefrontAppearance } from '@/types/store'
import { buildStoreBranding, type StoreBranding } from '@/composables/useStoreBranding'

export interface StoreThemeTokens extends StoreBranding {
  /** Full semantic token map for the storefront theme engine (--store-*, --motion-*). */
  cssVars: Record<string, string>
}

type ThemeAppearance = Pick<
  StorefrontAppearance,
  'secondary_color' | 'radius_style' | 'motion_enabled' | 'motion_intensity'
>

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function sanitizeThemeColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim()
  return normalizedValue && HEX_COLOR_PATTERN.test(normalizedValue) ? normalizedValue : fallback
}

function buildRadiusVars(radiusStyle: ThemeAppearance['radius_style'] | undefined): Record<string, string> {
  switch (radiusStyle) {
    case 'minimal':
      return {
        '--store-radius-sm': '0.25rem',
        '--store-radius-md': '0.5rem',
        '--store-radius-lg': '0.75rem',
      }
    case 'soft':
      return {
        '--store-radius-sm': '0.75rem',
        '--store-radius-md': '1.25rem',
        '--store-radius-lg': '2rem',
      }
    default:
      return {
        '--store-radius-sm': '0.5rem',
        '--store-radius-md': '0.95rem',
        '--store-radius-lg': '1.5rem',
      }
  }
}

function buildMotionVars(appearance: ThemeAppearance | null | undefined): Record<string, string> {
  if (appearance?.motion_enabled === false) {
    return {
      '--motion-fast': '0ms',
      '--motion-base': '0ms',
      '--motion-slow': '0ms',
    }
  }

  if (appearance?.motion_intensity === 'subtle') {
    return {
      '--motion-fast': '100ms',
      '--motion-base': '140ms',
      '--motion-slow': '180ms',
    }
  }

  // Common transitions stay in the ~120-220ms band (Ciclo 1 motion budget).
  return {
    '--motion-fast': '120ms',
    '--motion-base': '160ms',
    '--motion-slow': '220ms',
  }
}

/**
 * Editable per-store colors only. Every derived token (hover/soft shades,
 * radius, motion) is computed in CSS from these -- see storefront-theme.css --
 * so no component ever needs to know a store's raw hex values.
 */
export function buildStoreTheme(
  store: Store | null | undefined,
  appearance?: ThemeAppearance | null,
): StoreThemeTokens {
  const branding = buildStoreBranding(store)

  return {
    ...branding,
    cssVars: {
      ...branding.cssVars,
      '--store-secondary-base': sanitizeThemeColor(appearance?.secondary_color, branding.theme.accent),
      ...buildRadiusVars(appearance?.radius_style),
      ...buildMotionVars(appearance),
    },
  }
}

export function useStoreTheme(
  store: Ref<Store | null> | ComputedRef<Store | null>,
  appearance?: Ref<ThemeAppearance | null> | ComputedRef<ThemeAppearance | null>,
) {
  return computed(() => buildStoreTheme(store.value, appearance?.value))
}
