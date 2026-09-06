import { beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../api'
import { storeService } from '../store.service'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('StoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the current resolved store', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        id: 1,
        name: 'Loja Principal',
        display_name: 'Boutique Principal',
        slug: 'default',
        logo_url: 'https://example.com/logo.png',
        tagline: 'Catalogo online',
        whatsapp_phone: '5571999999999',
        theme: {
          primary: '#05050A',
          accent: '#111827',
        },
        is_active: true,
        status: 'active',
      },
    } as never)

    const response = await storeService.getCurrent()

    expect(api.get).toHaveBeenCalledWith('v1/store/current/')
    expect(response.slug).toBe('default')
    expect(response.display_name).toBe('Boutique Principal')
    expect(response.logo_url).toBe('https://example.com/logo.png')
    expect(response.tagline).toBe('Catalogo online')
    expect(response.status).toBe('active')
    expect(response.is_active).toBe(true)
  })

  it('updates controlled storefront appearance', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: {
        id: 1,
        name: 'Loja Principal',
        slug: 'default',
        whatsapp_phone: '',
        theme: { primary: '#111111' },
        is_active: true,
        receipt_exchange_policy: '',
        receipt_paper_format: '80mm',
      },
    } as never)

    const payload = { display_name: 'Boutique', tagline: 'Nova vitrine', theme: { primary: '#111111' } }
    const response = await storeService.updateAppearance('default', payload)

    expect(api.patch).toHaveBeenCalledWith('v1/store/mine/default/appearance/', payload)
    expect(response.theme?.primary).toBe('#111111')
  })

  it('updates controlled storefront appearance for the active store', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: {
        id: 1,
        name: 'Loja Principal',
        slug: 'default',
        whatsapp_phone: '',
        theme: { primary: '#111111' },
        is_active: true,
        receipt_exchange_policy: '',
        receipt_paper_format: '80mm',
      },
    } as never)

    const payload = { display_name: 'Boutique', tagline: 'Nova vitrine', theme: { primary: '#111111' } }
    const response = await storeService.updateCurrentAppearance(payload)

    expect(api.patch).toHaveBeenCalledWith('v1/store/current/appearance/', payload)
    expect(response.theme?.primary).toBe('#111111')
  })

  it('fetches and updates label settings', async () => {
    const settings = {
      page_format: 'a4' as const,
      columns: 3,
      rows: 7,
      margin_mm: 8,
      cell_padding_mm: 3,
      qr_size_mm: 24,
      show_price: true,
      show_size: false,
      show_public_code: true,
      labels_per_page: 21,
    }
    vi.mocked(api.get).mockResolvedValueOnce({ data: settings } as never)
    vi.mocked(api.patch).mockResolvedValueOnce({ data: settings } as never)

    await expect(storeService.getLabelSettings('default')).resolves.toEqual(settings)
    await expect(storeService.updateLabelSettings('default', { columns: 3 })).resolves.toEqual(settings)

    expect(api.get).toHaveBeenCalledWith('v1/store/mine/default/label-settings/')
    expect(api.patch).toHaveBeenCalledWith('v1/store/mine/default/label-settings/', { columns: 3 })
  })

  it('fetches the merchant profile from the current-store endpoint', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { trade_name: 'Boutique X', is_complete: false },
    } as never)

    const response = await storeService.getMerchantProfile()

    expect(api.get).toHaveBeenCalledWith('v1/store/current/merchant-profile/')
    expect(response.trade_name).toBe('Boutique X')
  })

  it('PATCHes the merchant profile with only the provided fields', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      data: { trade_name: 'Boutique X', instagram_url: 'https://instagram.com/x' },
    } as never)

    const response = await storeService.updateMerchantProfile({
      instagram_url: 'https://instagram.com/x',
    })

    expect(api.patch).toHaveBeenCalledWith('v1/store/current/merchant-profile/', {
      instagram_url: 'https://instagram.com/x',
    })
    expect(response.instagram_url).toBe('https://instagram.com/x')
  })
})
