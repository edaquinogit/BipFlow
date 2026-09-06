import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ProductCard from '../ProductCard.vue'

describe('ProductCard', () => {
  const mockProduct = {
    id: 1,
    name: 'Test Product',
    slug: 'test-product',
    price: '99.90',
    category: { id: 1, name: 'Test Category', slug: 'test-category' },
    image: 'https://example.com/image.jpg',
    stock_quantity: 10,
    is_available: true,
    created_at: '2024-01-01T00:00:00Z',
  }

  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    wrapper = mount(ProductCard, {
      props: { product: mockProduct, cartQuantity: 2 },
    })
  })

  it('renders core product data', () => {
    expect(wrapper.text()).toContain('Test Product')
    expect(wrapper.text()).toContain('Test Category')
    expect(wrapper.text()).toContain('R$')
    expect(wrapper.text()).toContain('99,90')
  })

  it('shows how many of this product are already in the order', () => {
    expect(wrapper.text()).toContain('2 no pedido')
  })

  it('shows a single price when active variants agree, "A partir de" when they differ', () => {
    const agree = mount(ProductCard, {
      props: {
        product: {
          ...mockProduct,
          variants: [
            { id: 1, name: 'A', color_hex: '#111827', price: null, effective_price: '99.90', stock_quantity: 3, image: null, is_active: true, position: 0 },
            { id: 2, name: 'B', color_hex: '#222222', price: null, effective_price: '99.90', stock_quantity: 3, image: null, is_active: true, position: 1 },
          ],
        },
      },
    })
    expect(agree.text()).not.toContain('A partir de')

    const differ = mount(ProductCard, {
      props: {
        product: {
          ...mockProduct,
          variants: [
            { id: 1, name: 'A', color_hex: '#111827', price: null, effective_price: '99.90', stock_quantity: 3, image: null, is_active: true, position: 0 },
            { id: 2, name: 'B', color_hex: '#222222', price: '129.90', effective_price: '129.90', stock_quantity: 3, image: null, is_active: true, position: 1 },
          ],
        },
      },
    })
    expect(differ.text()).toContain('A partir de')
    expect(differ.text()).toContain('99,90')
  })

  it('opens the product detail when the card is clicked', async () => {
    await wrapper.get('button[aria-label="Ver Test Product"]').trigger('click')
    expect(wrapper.emitted('openDetails')?.[0]).toEqual([mockProduct])
  })

  it('adds a single unit to the cart from the card CTA', async () => {
    await wrapper.get('[data-cy="add-to-cart-button"]').trigger('click')
    expect(wrapper.emitted('addToCart')?.[0]).toEqual([mockProduct, 1])
    // the card click-through must not also fire
    expect(wrapper.emitted('openDetails')).toBeUndefined()
  })

  it('adds the first colour variant with available stock', async () => {
    const productWithVariants = {
      ...mockProduct,
      variants: [
        { id: 10, name: 'Preto', color_hex: '#000000', stock_quantity: 0, image: 'https://example.com/preto.jpg', is_active: true, position: 0 },
        { id: 11, name: 'Azul', color_hex: '#3366FF', stock_quantity: 2, image: 'https://example.com/azul.jpg', is_active: true, position: 1 },
      ],
    }
    await wrapper.setProps({ product: productWithVariants, cartQuantity: 0 })

    expect(wrapper.text()).toContain('2 nesta cor')
    await wrapper.get('[data-cy="add-to-cart-button"]').trigger('click')
    expect(wrapper.emitted('addToCart')?.at(-1)).toEqual([
      productWithVariants,
      1,
      expect.objectContaining({ id: 11, name: 'Azul' }),
    ])
  })

  it('disables the CTA and marks the product sold out when unavailable', async () => {
    await wrapper.setProps({ product: { ...mockProduct, is_available: false } })
    const cta = wrapper.get('[data-cy="add-to-cart-button"]')
    expect(cta.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Esgotado')
    expect(wrapper.text()).toContain('Indisponível')
  })

  it('keeps product images lazy and asynchronously decoded', () => {
    const img = wrapper.find('img')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('decoding')).toBe('async')
    expect(img.attributes('alt')).toBe('Imagem do produto Test Product')
  })

  it('does not clutter comfortably-stocked cards with an availability tag', async () => {
    await wrapper.setProps({ cartQuantity: 0 })
    expect(wrapper.text()).not.toContain('Disponivel')
    expect(wrapper.text()).not.toContain('restantes')
  })

  it('surfaces the remaining count only when stock is low', async () => {
    await wrapper.setProps({ product: { ...mockProduct, stock_quantity: 5 }, cartQuantity: 0 })
    expect(wrapper.text()).toContain('5 restantes')
  })

  it("respects the product's own low_stock_threshold", async () => {
    await wrapper.setProps({
      product: { ...mockProduct, stock_quantity: 15, low_stock_threshold: 20 },
      cartQuantity: 0,
    })
    expect(wrapper.text()).toContain('15 restantes')
  })
})
