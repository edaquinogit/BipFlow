import { describe, expect, it } from 'vitest'
import {
  CommerceSettingsSchema,
  PublicCommerceSettingsSchema,
  commerceSettingsInvariantErrors,
} from '../commerceSettings.schema'

describe('commerceSettings schema', () => {
  const validAdmin = {
    orders_enabled: true,
    delivery_enabled: true,
    pickup_enabled: false,
    minimum_order_value: '25.00',
    accepts_pix: true,
    accepts_card: false,
    accepts_cash: true,
    enabled_delivery_methods: ['delivery'],
    enabled_payment_methods: ['pix', 'cash'],
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  }

  it('parses a valid admin payload', () => {
    const parsed = CommerceSettingsSchema.parse(validAdmin)
    expect(parsed.minimum_order_value).toBe('25.00')
    expect(parsed.enabled_payment_methods).toEqual(['pix', 'cash'])
  })

  it('coerces a numeric minimum_order_value to a string', () => {
    const parsed = CommerceSettingsSchema.parse({ ...validAdmin, minimum_order_value: 30 })
    expect(parsed.minimum_order_value).toBe('30')
  })

  it('parses a public payload and rejects unknown delivery methods', () => {
    const parsed = PublicCommerceSettingsSchema.parse({
      orders_enabled: true,
      delivery_enabled: true,
      pickup_enabled: true,
      minimum_order_value: '0.00',
      accepts_pix: true,
      accepts_card: true,
      accepts_cash: true,
      delivery_methods: ['delivery', 'pickup'],
      payment_methods: ['pix'],
    })
    expect(parsed.delivery_methods).toEqual(['delivery', 'pickup'])

    expect(() =>
      PublicCommerceSettingsSchema.parse({
        ...parsed,
        delivery_methods: ['drone'],
      }),
    ).toThrow()
  })
})

describe('commerceSettingsInvariantErrors', () => {
  const base = {
    orders_enabled: true,
    delivery_enabled: true,
    pickup_enabled: true,
    minimum_order_value: '0.00',
    accepts_pix: true,
    accepts_card: true,
    accepts_cash: true,
  }

  it('returns no errors for a valid combination', () => {
    expect(commerceSettingsInvariantErrors(base)).toEqual({})
  })

  it('flags a negative minimum', () => {
    expect(commerceSettingsInvariantErrors({ ...base, minimum_order_value: '-1' }))
      .toHaveProperty('minimum_order_value')
  })

  it('flags an open store with no delivery mode', () => {
    expect(
      commerceSettingsInvariantErrors({
        ...base,
        delivery_enabled: false,
        pickup_enabled: false,
      }),
    ).toHaveProperty('delivery_enabled')
  })

  it('flags an open store with no payment method', () => {
    expect(
      commerceSettingsInvariantErrors({
        ...base,
        accepts_pix: false,
        accepts_card: false,
        accepts_cash: false,
      }),
    ).toHaveProperty('accepts_pix')
  })

  it('allows a fully closed store to have nothing enabled', () => {
    expect(
      commerceSettingsInvariantErrors({
        orders_enabled: false,
        delivery_enabled: false,
        pickup_enabled: false,
        minimum_order_value: '0.00',
        accepts_pix: false,
        accepts_card: false,
        accepts_cash: false,
      }),
    ).toEqual({})
  })
})
