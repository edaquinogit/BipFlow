import { describe, expect, it, vi } from 'vitest'
import {
  PRODUCT_IMAGE_PLACEHOLDER,
  handleProductImageError,
  resolveProductImage,
} from '../productImagePlaceholder'

describe('productImagePlaceholder', () => {
  it('is a self-contained inline SVG data URI (no external request)', () => {
    expect(PRODUCT_IMAGE_PLACEHOLDER.startsWith('data:image/svg+xml')).toBe(true)
    const decoded = decodeURIComponent(PRODUCT_IMAGE_PLACEHOLDER.split(',')[1] ?? '')
    // No nested <image>/href that would trigger a network fetch.
    expect(decoded).not.toContain('<image')
    expect(decoded).not.toContain('href')
  })

  it('resolves the first non-empty candidate', () => {
    expect(resolveProductImage(null, '  ', 'https://cdn/x.jpg')).toBe('https://cdn/x.jpg')
    expect(resolveProductImage('  https://cdn/y.jpg  ')).toBe('https://cdn/y.jpg')
  })

  it('falls back to the shared placeholder when every candidate is empty', () => {
    expect(resolveProductImage(null, undefined, '')).toBe(PRODUCT_IMAGE_PLACEHOLDER)
  })

  it('swaps a broken image to the placeholder exactly once', () => {
    const img = { src: 'https://cdn/broken.jpg' } as HTMLImageElement
    handleProductImageError({ target: img } as unknown as Event)
    expect(img.src).toBe(PRODUCT_IMAGE_PLACEHOLDER)

    // A second error on the already-placeholder image must not loop.
    const setter = vi.fn()
    Object.defineProperty(img, 'src', { get: () => PRODUCT_IMAGE_PLACEHOLDER, set: setter })
    handleProductImageError({ target: img } as unknown as Event)
    expect(setter).not.toHaveBeenCalled()
  })
})
