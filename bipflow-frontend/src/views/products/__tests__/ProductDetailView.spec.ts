import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import ProductDetailView from '../ProductDetailView.vue'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useToast } from '@/composables/useToast'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { Logger } from '@/services/logger'
import { orderService } from '@/services/order.service'
import productService from '@/services/product.service'
import { storeSettingsService } from '@/services/store-settings.service'
import { useRoute, useRouter } from 'vue-router'

vi.mock('@/composables/useCart', () => ({
  useCart: vi.fn(),
}))

vi.mock('@/composables/useCurrentStore', () => ({
  useCurrentStore: vi.fn(),
}))

vi.mock('@/composables/usePublicStorefrontAppearance', () => ({
  usePublicStorefrontAppearance: vi.fn(),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: vi.fn(),
}))

vi.mock('@/services/delivery-region.service', () => ({
  deliveryRegionService: {
    getActive: vi.fn(),
  },
}))

vi.mock('@/services/store-settings.service', () => ({
  storeSettingsService: {
    getPublic: vi.fn(),
  },
}))

vi.mock('@/services/order.service', () => ({
  orderService: {
    checkoutViaWhatsApp: vi.fn(),
  },
}))

vi.mock('@/services/product.service', () => ({
  default: {
    getPublicBySlug: vi.fn(),
    getPublicByCode: vi.fn(),
  },
}))

vi.mock('@/services/logger', () => ({
  Logger: {
    warn: vi.fn(),
  },
}))

vi.mock('@/services/store-scope', () => ({
  setSelectedStoreSlug: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: vi.fn(),
  useRouter: vi.fn(),
}))

const CartDrawerStub = defineComponent({
  name: 'CartDrawer',
  template: '<div class="cart-drawer-stub"></div>',
})

const FloatingCartButtonStub = defineComponent({
  name: 'FloatingCartButton',
  template: '<div class="floating-cart-button-stub"></div>',
})

describe('ProductDetailView', () => {
  let wrapper: ReturnType<typeof mount>

  const toastMock = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }

  const productDetail = {
    id: 7,
    name: 'Premium Burger',
    slug: 'premium-burger',
    sku: 'PB-001',
    description: 'Blend especial com queijo e molho da casa.',
    price: '42.50',
    size: 'Grande',
    category: { id: 3, name: 'Lanches', slug: 'lanches' },
    image: 'https://example.com/product.jpg',
    images: ['https://example.com/product.jpg'],
    stock_quantity: 9,
    is_available: true,
    created_at: '2024-01-01T00:00:00Z',
  }

  const cartState = {
    items: ref([]),
    customer: ref({
      fullName: '',
      phone: '',
      email: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'pix',
      deliveryRegionId: null,
      deliveryRegionName: '',
      deliveryRegionFee: 0,
      address: '',
      neighborhood: '',
      city: '',
      notes: '',
    }),
    itemCount: ref(0),
    subtotal: ref(0),
    deliveryFee: ref(0),
    total: ref(0),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    clearCart: vi.fn(),
    updateCustomer: vi.fn(),
    resetCustomer: vi.fn(),
    getProductQuantity: vi.fn(() => 0),
  }

  const currentStoreState = {
    selectedStore: ref({
      id: 1,
      name: 'Loja Principal',
      slug: 'default',
      logo_url: 'https://example.com/logo.png',
      tagline: 'Catalogo online',
      whatsapp_phone: '5579999999999',
      theme: {
        primary: '#111111',
        accent: '#111827',
        background: '#FAFAFA',
        surface: '#FFFFFF',
        text: '#05050A',
        muted: '#6B7280',
      },
      is_active: true,
      status: 'active',
    }),
    fetchCurrentStore: vi.fn(),
  }

  const mountView = () => mount(ProductDetailView, {
    global: {
      stubs: {
        CartDrawer: CartDrawerStub,
        FloatingCartButton: FloatingCartButtonStub,
      },
    },
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/l/default/produtos/premium-burger')

    vi.mocked(useToast).mockReturnValue(toastMock as any)
    vi.mocked(useCart).mockReturnValue(cartState as any)
    vi.mocked(useCurrentStore).mockReturnValue(currentStoreState as any)
    vi.mocked(usePublicStorefrontAppearance).mockReturnValue({
      appearance: ref(null),
      isLoading: ref(false),
      loadError: ref(null),
      load: vi.fn(),
    } as any)
    vi.mocked(useRoute).mockReturnValue({
      params: {
        storeSlug: 'default',
        slug: 'premium-burger',
      },
    } as any)
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(() => Promise.resolve()),
    } as any)
    vi.mocked(productService.getPublicBySlug).mockResolvedValue(productDetail as any)
    vi.mocked(productService.getPublicByCode).mockResolvedValue(productDetail as any)
    vi.mocked(deliveryRegionService.getActive).mockResolvedValue([])
    vi.mocked(storeSettingsService.getPublic).mockResolvedValue({
      whatsapp_phone_digits: '5579999999999',
      is_whatsapp_configured: true,
    } as any)
    vi.mocked(orderService.checkoutViaWhatsApp).mockResolvedValue({} as any)

    Object.defineProperty(navigator, 'share', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(),
      },
      configurable: true,
    })

    wrapper = mountView()
    await flushPromises()
    await nextTick()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  it('renders a share button inside the product detail card', () => {
    expect(wrapper.find('[aria-label="Compartilhar produto"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Premium Burger')
  })

  it('uses the native share sheet when navigator.share is available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'share', {
      value: share,
      configurable: true,
      writable: true,
    })

    await wrapper.find('[aria-label="Compartilhar produto"]').trigger('click')

    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Premium Burger',
      url: expect.stringContaining('/l/default/produtos/premium-burger'),
    }))
  })

  it('falls back to copying the public product link when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await wrapper.find('[aria-label="Compartilhar produto"]').trigger('click')

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/l/default/produtos/premium-burger'))
    expect(toastMock.success).toHaveBeenCalledWith('Link do produto copiado.')
    expect(wrapper.find('[aria-label="Link do produto copiado"]').exists()).toBe(true)
  })

  it('shares a canonical URL without current query params or hash', async () => {
    const share = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'share', {
      value: share,
      configurable: true,
      writable: true,
    })

    window.history.replaceState({}, '', '/l/default/produtos/premium-burger?utm=campaign#hero')

    await wrapper.find('[aria-label="Compartilhar produto"]').trigger('click')

    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      url: `${window.location.origin}/l/default/produtos/premium-burger`,
    }))
  })

  it('builds a canonical deep-link when route is code-based', async () => {
    wrapper.unmount()

    vi.mocked(useRoute).mockReturnValue({
      params: {
        storeSlug: 'default',
        code: 'ABC123XYZ',
      },
    } as any)

    window.history.replaceState({}, '', '/l/default/p/ABC123XYZ?utm=qr')

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    await wrapper.find('[aria-label="Compartilhar produto"]').trigger('click')

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/l/default/p/ABC123XYZ`)
  })

  it('switches the gallery image and cart payload when a color variant is selected', async () => {
    wrapper.unmount()
    cartState.addItem.mockClear()
    vi.mocked(productService.getPublicBySlug).mockResolvedValue({
      ...productDetail,
      variants: [
        {
          id: 10,
          name: 'Preto',
          color_hex: '#000000',
          stock_quantity: 4,
          image: 'https://example.com/preto.jpg',
          is_active: true,
          position: 0,
        },
        {
          id: 11,
          name: 'Azul',
          color_hex: '#3366FF',
          stock_quantity: 3,
          image: 'https://example.com/azul.jpg',
          is_active: true,
          position: 1,
        },
      ],
    } as any)

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    expect(wrapper.find('img[alt="Imagem do produto Premium Burger"]').attributes('src'))
      .toBe('https://example.com/preto.jpg')

    await wrapper.find('[aria-label="Selecionar cor Azul"]').trigger('click')
    await nextTick()

    expect(wrapper.find('img[alt="Imagem do produto Premium Burger"]').attributes('src'))
      .toBe('https://example.com/azul.jpg')

    const addButton = wrapper.findAll('button').find((button) =>
      button.text().includes('Adicionar ao pedido')
    )
    expect(addButton).toBeDefined()

    await addButton!.trigger('click')

    expect(cartState.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      1,
      expect.objectContaining({ id: 11, name: 'Azul' }),
    )
  })

  it('reflects the selected variant price in the header and updates on selection', async () => {
    wrapper.unmount()
    vi.mocked(productService.getPublicBySlug).mockResolvedValue({
      ...productDetail,
      price: '42.50',
      variants: [
        {
          id: 10, name: 'Padrao', color_hex: '#000000', price: null,
          effective_price: '42.50', stock_quantity: 4, image: null,
          is_active: true, position: 0,
        },
        {
          id: 11, name: 'Premium', color_hex: '#3366FF', price: '59.90',
          effective_price: '59.90', stock_quantity: 3, image: null,
          is_active: true, position: 1,
        },
      ],
    } as any)

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    // "Padrao" is auto-selected (first orderable) -> its effective price.
    expect(wrapper.text()).toContain('42,50')

    await wrapper.find('[aria-label="Selecionar cor Premium"]').trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('59,90')
  })

  it('falls back to copying the public product link when native share fails', async () => {
    const share = vi.fn().mockRejectedValue(new Error('share_failed'))
    const writeText = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'share', {
      value: share,
      configurable: true,
      writable: true,
    })

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await wrapper.find('[aria-label="Compartilhar produto"]').trigger('click')
    await flushPromises()

    expect(share).toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/l/default/produtos/premium-burger'))
    expect(Logger.warn).toHaveBeenCalled()
  })

  it('offers a persistent purchase bar with a running total and adds from it', async () => {
    // The mobile sticky bar shows quantity x unit price and adds to the cart.
    await wrapper.find('button[aria-label="Aumentar quantidade"]').trigger('click')
    await nextTick()

    const stickyAdd = wrapper.findAll('button').find((b) => b.text().trim() === 'Adicionar')
    expect(stickyAdd).toBeDefined()

    // 2 x 42,50 = 85,00
    expect(wrapper.text()).toContain('85,00')

    await stickyAdd!.trigger('click')
    expect(cartState.addItem).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 2, null)
  })

  it('orders the mobile content as image -> price -> purchase controls -> description', () => {
    const html = wrapper.html()
    const priceIndex = html.indexOf('42,50')
    const quantityIndex = html.indexOf('Quantidade')
    const descriptionIndex = html.indexOf('Blend especial')
    expect(priceIndex).toBeGreaterThan(-1)
    expect(priceIndex).toBeLessThan(quantityIndex)
    expect(quantityIndex).toBeLessThan(descriptionIndex)
  })
})
