import { describe, expect, it } from 'vitest'
import { displayPrice, effectiveUnitPrice } from '../pricing'
import type { Product, ProductVariant } from '@/types/product'

const variant = (over: Partial<ProductVariant>): ProductVariant => ({
  id: 1, name: 'V', color_hex: '#111827', price: null,
  effective_price: '', stock_quantity: 5, image: null, is_active: true,
  position: 0, ...over,
})
const product = (variants: ProductVariant[]): Product => ({
  id: 1, name: 'Baseline', slug: 'baseline', price: '59.90',
  category: { id: 1, name: 'C', slug: 'c' }, image: null,
  stock_quantity: 10, is_available: true, created_at: '2026-01-01T00:00:00Z',
  variants,
})

describe('Product management baseline', () => {
  it('preserves explicit zero rather than inheriting the base price', () => {
    const p = product([])
    expect(effectiveUnitPrice(p, variant({ price: '0.00' }))).toBe('0.00')
    expect(effectiveUnitPrice(p, variant({ effective_price: '0.00' }))).toBe('0.00')
    expect(effectiveUnitPrice(p, variant({ price: null }))).toBe('59.90')
  })

  it('advertises only purchasable variants when stock is available', () => {
    const p = product([
      variant({ id: 1, effective_price: '0.00', is_active: false }),
      variant({ id: 2, effective_price: '10.00', stock_quantity: 0 }),
      variant({ id: 3, effective_price: '69.90' }),
      variant({ id: 4, effective_price: '79.90' }),
    ])
    expect(displayPrice(p)).toEqual({ amount: '69.90', from: true })
  })
})
