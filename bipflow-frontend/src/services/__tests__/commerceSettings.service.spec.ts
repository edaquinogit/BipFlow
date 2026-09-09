import { beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../api'
import { commerceSettingsService } from '../commerceSettings.service'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}))

const validAdmin = {
  orders_enabled: true,
  delivery_enabled: true,
  pickup_enabled: true,
  minimum_order_value: '0.00',
  accepts_pix: true,
  accepts_card: true,
  accepts_cash: true,
  enabled_delivery_methods: ['delivery', 'pickup'],
  enabled_payment_methods: ['pix', 'card', 'cash'],
}

const validPublic = {
  orders_enabled: false,
  delivery_enabled: true,
  pickup_enabled: false,
  minimum_order_value: '40.00',
  accepts_pix: true,
  accepts_card: false,
  accepts_cash: false,
  delivery_methods: ['delivery'],
  payment_methods: ['pix'],
}

describe('commerceSettingsService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('get() reads the current-store endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: validAdmin } as never)
    const result = await commerceSettingsService.get()
    expect(api.get).toHaveBeenCalledWith('v1/store/current/commerce-settings/')
    expect(result.enabled_payment_methods).toEqual(['pix', 'card', 'cash'])
  })

  it('update() patches with the given payload', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: { ...validAdmin, minimum_order_value: '15.00' },
    } as never)
    const result = await commerceSettingsService.update({ minimum_order_value: '15.00' })
    expect(api.patch).toHaveBeenCalledWith(
      'v1/store/current/commerce-settings/',
      { minimum_order_value: '15.00' },
    )
    expect(result.minimum_order_value).toBe('15.00')
  })

  it('getPublic() hits the slug-scoped endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: validPublic } as never)
    const result = await commerceSettingsService.getPublic('boutique fitness')
    expect(api.get).toHaveBeenCalledWith(
      'v1/public/stores/boutique%20fitness/commerce-settings/',
    )
    expect(result.orders_enabled).toBe(false)
    expect(result.payment_methods).toEqual(['pix'])
  })

  it('falls back to the raw payload when validation fails', async () => {
    const drifted = { ...validPublic, delivery_methods: ['drone'] }
    vi.mocked(api.get).mockResolvedValue({ data: drifted } as never)
    const result = await commerceSettingsService.getPublic('default')
    expect(result).toBe(drifted)
  })
})
