import { beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../api'
import { storefrontAppearanceService } from '../storefront-appearance.service'
import type { StorefrontAppearance, StorefrontBanner } from '@/types/store'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

function buildAppearance(overrides: Partial<StorefrontAppearance> = {}): StorefrontAppearance {
  return {
    id: 10,
    store_id: 1,
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
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildBanner(overrides: Partial<StorefrontBanner> = {}): StorefrontBanner {
  return {
    id: 10,
    store_id: 1,
    placement: 'promotion',
    image_url: 'https://cdn.example.com/promo.png',
    image_url_mobile: '',
    alt_text: 'Promocao',
    title: 'Oferta',
    subtitle: 'Itens selecionados',
    cta_text: 'Ver',
    destination_type: 'products',
    destination_value: '',
    button_url: '/l/loja-a/produtos',
    position: 0,
    is_active: true,
    status: 'active',
    starts_at: null,
    ends_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('storefrontAppearanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and updates the active store appearance', async () => {
    const appearance = buildAppearance({ hero_enabled: true })
    vi.mocked(api.get).mockResolvedValueOnce({ data: appearance } as never)
    vi.mocked(api.patch).mockResolvedValueOnce({ data: appearance } as never)

    await expect(storefrontAppearanceService.get()).resolves.toEqual(appearance)
    await expect(storefrontAppearanceService.update({ hero_enabled: true })).resolves.toEqual(appearance)

    expect(api.get).toHaveBeenCalledWith('v1/store/current/storefront-appearance/')
    expect(api.patch).toHaveBeenCalledWith('v1/store/current/storefront-appearance/', {
      hero_enabled: true,
    })
  })

  it('fetches the public visitor-facing appearance by slug', async () => {
    const { id: _id, store_id: _storeId, updated_at: _updatedAt, ...appearanceFields } = buildAppearance({
      hero_enabled: true,
    })
    const appearance = {
      ...appearanceFields,
      store_name: 'Loja A',
      store_slug: 'loja-a',
      logo_url: 'https://example.com/logo.png',
      tagline: 'Catalogo online',
      theme: { primary: '#111111' },
    }
    vi.mocked(api.get).mockResolvedValueOnce({ data: appearance } as never)

    await expect(storefrontAppearanceService.getPublic('loja-a')).resolves.toEqual(appearance)

    expect(api.get).toHaveBeenCalledWith('v1/public/stores/loja-a/appearance/')
  })

  it('fetches public active promotional banners by slug', async () => {
    const banners = [
      {
        image_url: 'https://cdn.example.com/promo.png',
        alt_text: 'Promocao',
        title: 'Oferta',
        subtitle: '',
        cta_text: 'Ver',
        button_url: '/l/loja-a/produtos',
        position: 0,
        status: 'active',
      },
    ]
    vi.mocked(api.get).mockResolvedValueOnce({ data: banners } as never)

    await expect(storefrontAppearanceService.getPublicBanners('loja-a')).resolves.toEqual(banners)

    expect(api.get).toHaveBeenCalledWith('v1/public/stores/loja-a/banners/')
  })

  it('manages active-store promotional banner CRUD and ordering', async () => {
    const banner = buildBanner()
    vi.mocked(api.get).mockResolvedValueOnce({ data: [banner] } as never)
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: banner } as never)
      .mockResolvedValueOnce({ data: [buildBanner({ id: 11, position: 0 }), buildBanner({ position: 1 })] } as never)
    vi.mocked(api.patch).mockResolvedValueOnce({ data: buildBanner({ title: 'Nova oferta' }) } as never)
    vi.mocked(api.delete).mockResolvedValueOnce({} as never)

    await expect(storefrontAppearanceService.listBanners()).resolves.toEqual([banner])
    await expect(storefrontAppearanceService.createBanner({ image_url: banner.image_url })).resolves.toEqual(banner)
    await expect(storefrontAppearanceService.updateBanner(10, { title: 'Nova oferta' })).resolves.toMatchObject({ title: 'Nova oferta' })
    await expect(storefrontAppearanceService.deleteBanner(10)).resolves.toBeUndefined()
    await expect(storefrontAppearanceService.reorderBanners([11, 10])).resolves.toHaveLength(2)

    expect(api.get).toHaveBeenCalledWith('v1/store/current/storefront-banners/', {
      params: { placement: 'promotion' },
    })
    expect(api.post).toHaveBeenNthCalledWith(1, 'v1/store/current/storefront-banners/', {
      image_url: banner.image_url,
    })
    expect(api.patch).toHaveBeenCalledWith('v1/store/current/storefront-banners/10/', {
      title: 'Nova oferta',
    })
    expect(api.delete).toHaveBeenCalledWith('v1/store/current/storefront-banners/10/')
    expect(api.post).toHaveBeenNthCalledWith(2, 'v1/store/current/storefront-banners/reorder/', {
      ids: [11, 10],
      placement: 'promotion',
    })
  })

  it('scopes banner list and reorder to the hero placement when requested', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] } as never)
    vi.mocked(api.post).mockResolvedValueOnce({ data: [] } as never)

    await storefrontAppearanceService.listBanners('hero')
    await storefrontAppearanceService.reorderBanners([1, 2], 'hero')

    expect(api.get).toHaveBeenCalledWith('v1/store/current/storefront-banners/', {
      params: { placement: 'hero' },
    })
    expect(api.post).toHaveBeenCalledWith('v1/store/current/storefront-banners/reorder/', {
      ids: [1, 2],
      placement: 'hero',
    })
  })

  it('uploads active-store storefront media as multipart form data', async () => {
    const file = new File(['image'], 'logo.png', { type: 'image/png' })
    const uploadResponse = {
      kind: 'logo',
      url: 'https://cdn.example.com/logo.png',
      path: 'stores/1/storefront/logo/logo.png',
      size: file.size,
      content_type: 'image/png',
    }
    vi.mocked(api.post).mockResolvedValueOnce({ data: uploadResponse } as never)

    await expect(storefrontAppearanceService.uploadMedia('logo', file)).resolves.toEqual(uploadResponse)

    expect(api.post).toHaveBeenCalledWith(
      'v1/store/current/storefront-media/',
      expect.any(FormData),
      {
        headers: { 'Content-Type': undefined },
        timeout: 60000,
      },
    )

    const firstPostCall = vi.mocked(api.post).mock.calls[0]!
    const formData = firstPostCall[1] as FormData
    expect(formData.get('kind')).toBe('logo')
    expect(formData.get('file')).toBe(file)
  })
})
