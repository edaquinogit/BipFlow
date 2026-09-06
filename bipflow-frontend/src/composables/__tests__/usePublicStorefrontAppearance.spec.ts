import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { usePublicStorefrontAppearance } from '../usePublicStorefrontAppearance'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { PublicStorefrontAppearance } from '@/types/store'

vi.mock('@/services/storefront-appearance.service', () => ({
  storefrontAppearanceService: {
    getPublic: vi.fn(),
  },
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function buildAppearance(overrides: Partial<PublicStorefrontAppearance> = {}): PublicStorefrontAppearance {
  return {
    store_name: 'Loja A',
    store_slug: 'loja-a',
    logo_url: 'https://example.com/logo.png',
    tagline: 'Catalogo online',
    theme: {
      primary: '#111111',
      accent: '#111827',
      background: '#FAFAFA',
      surface: '#FFFFFF',
      text: '#05050A',
      muted: '#6B7280',
    },
    secondary_color: '#374151',
    favicon_url: '',
    hero_enabled: false,
    hero_image_desktop: '',
    hero_image_mobile: '',
    hero_alt_text: '',
    hero_title: '',
    hero_subtitle: '',
    hero_cta_text: '',
    hero_destination_type: 'none',
    hero_destination_value: '',
    hero_cta_url: '',
    card_style: 'clean',
    radius_style: 'rounded',
    density: 'comfortable',
    font_preset: 'modern',
    motion_enabled: true,
    motion_intensity: 'standard',
    decoration_enabled: false,
    decoration_style: 'none',
    merchant: {
      trade_name: '',
      city: '',
      state: '',
      website_url: '',
      instagram_url: '',
      facebook_url: '',
      tiktok_url: '',
      youtube_url: '',
    },
    ...overrides,
  }
}

describe('usePublicStorefrontAppearance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads public appearance for the current slug', async () => {
    vi.mocked(storefrontAppearanceService.getPublic).mockResolvedValue(buildAppearance({
      secondary_color: '#00AAFF',
    }))

    const slug = ref('loja-a')
    const { appearance, isLoading } = usePublicStorefrontAppearance(slug)
    await flushPromises()

    expect(storefrontAppearanceService.getPublic).toHaveBeenCalledWith('loja-a')
    expect(isLoading.value).toBe(false)
    expect(appearance.value?.secondary_color).toBe('#00AAFF')
  })

  it('clears appearance without a slug and ignores stale responses after store switch', async () => {
    const storeARequest = createDeferred<PublicStorefrontAppearance>()
    const storeBRequest = createDeferred<PublicStorefrontAppearance>()
    vi.mocked(storefrontAppearanceService.getPublic).mockImplementation((slug) => (
      slug === 'loja-a' ? storeARequest.promise : storeBRequest.promise
    ))

    const slug = ref<string | null>('loja-a')
    const { appearance } = usePublicStorefrontAppearance(slug)

    slug.value = 'loja-b'
    await flushPromises()

    storeBRequest.resolve(buildAppearance({
      store_name: 'Loja B',
      store_slug: 'loja-b',
      secondary_color: '#0044FF',
    }))
    await flushPromises()

    expect(appearance.value?.store_slug).toBe('loja-b')
    expect(appearance.value?.secondary_color).toBe('#0044FF')

    storeARequest.resolve(buildAppearance({
      store_slug: 'loja-a',
      secondary_color: '#FF00AA',
    }))
    await flushPromises()

    expect(appearance.value?.store_slug).toBe('loja-b')

    slug.value = null
    await flushPromises()

    expect(appearance.value).toBeNull()
  })
})
