import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import ProductsView from '../ProductsView.vue'
import { useProductSearch } from '@/composables/useProductSearch'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useToast } from '@/composables/useToast'
import { categoryService } from '@/services/category.service'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { storeSettingsService } from '@/services/store-settings.service'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { Product } from '@/types/product'
import type { PublicStorefrontAppearance } from '@/types/store'
import { useRoute, useRouter } from 'vue-router'

vi.mock('@/composables/useProductSearch', () => ({
  useProductSearch: vi.fn(),
}))

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

vi.mock('@/services/category.service', () => ({
  categoryService: {
    getAll: vi.fn(),
  },
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

vi.mock('@/services/storefront-appearance.service', () => ({
  storefrontAppearanceService: {
    getPublicBanners: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: vi.fn(),
  useRouter: vi.fn(),
}))

const ProductCardStub = defineComponent({
  name: 'ProductCard',
  props: {
    product: { type: Object, required: true },
    cartQuantity: { type: Number, default: 0 },
  },
  emits: ['add-to-cart', 'open-details'],
  template: '<div class="product-card-stub">{{ product.name }}</div>',
})

const ProductPaginationStub = defineComponent({
  name: 'ProductPagination',
  props: {
    currentPage: { type: Number, required: true },
    totalPages: { type: Number, required: true },
    hasPreviousPage: { type: Boolean, required: true },
    hasNextPage: { type: Boolean, required: true },
    showingRange: { type: String, required: true },
  },
  emits: ['go-to-page', 'next-page', 'previous-page'],
  template: '<div class="product-pagination-stub"></div>',
})

const CartDrawerStub = defineComponent({
  name: 'CartDrawer',
  props: {
    isOpen: { type: Boolean, required: true },
    items: { type: Array, required: true },
    itemCount: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    total: { type: Number, required: true },
    customer: { type: Object, required: true },
    deliveryRegions: { type: Array, required: true },
    isDeliveryRegionsLoading: { type: Boolean, default: false },
    isSubmitting: { type: Boolean, default: false },
    isWhatsAppConfigured: { type: Boolean, required: true },
  },
  emits: [
    'close',
    'clear-cart',
    'remove-item',
    'update-quantity',
    'update-customer',
    'submit-order',
  ],
  template: '<div class="cart-drawer-stub"></div>',
})

function buildPublicAppearance(overrides: Partial<PublicStorefrontAppearance> = {}): PublicStorefrontAppearance {
  return {
    store_name: 'Loja Principal',
    store_slug: 'default',
    logo_url: 'https://example.com/logo.png',
    tagline: 'Catalogo premium',
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

describe('ProductsView', () => {
  let wrapper: ReturnType<typeof mount>
  const routerPush = vi.fn()
  const routerReplace = vi.fn(() => Promise.resolve())
  const windowOpen = vi.fn()

  const mockProduct: Product = {
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
  const mockProducts: Product[] = [mockProduct]

  const searchState = {
    products: ref(mockProducts),
    isLoading: ref(false),
    isInitialLoading: ref(false),
    isLoadingMore: ref(false),
    error: ref<string | null>(null),
    page: ref(1),
    totalPages: ref(1),
    filters: ref({
      search: '',
      categoryId: undefined,
      priceMin: undefined,
      priceMax: undefined,
      inStockOnly: false,
    }),
    hasNextPage: ref(false),
    hasPreviousPage: ref(false),
    showingRange: ref('Exibindo 1-1 de 1 produtos'),
    fetchProducts: vi.fn(),
    updateFilters: vi.fn(),
    clearFilters: vi.fn(),
    goToPage: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
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
    uniqueItemCount: ref(0),
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

  const toastMock = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }

  const currentStoreState = {
    selectedStore: ref({
      id: 1,
      name: 'Loja Principal',
      slug: 'default',
      logo_url: 'https://example.com/logo.png',
      tagline: 'Catalogo premium',
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

  const storefrontAppearanceState = {
    appearance: ref<PublicStorefrontAppearance | null>(null),
    isLoading: ref(false),
    loadError: ref<string | null>(null),
    load: vi.fn(),
  }

  const mountView = () =>
    mount(ProductsView, {
      global: {
        stubs: {
          ProductCard: ProductCardStub,
          ProductPagination: ProductPaginationStub,
          CartDrawer: CartDrawerStub,
        },
      },
    })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('open', windowOpen)

    searchState.products.value = mockProducts
    cartState.itemCount.value = 0

    vi.mocked(useProductSearch).mockReturnValue(searchState as any)
    vi.mocked(useCart).mockReturnValue(cartState as any)
    vi.mocked(useCurrentStore).mockReturnValue(currentStoreState as any)
    storefrontAppearanceState.appearance.value = null
    vi.mocked(usePublicStorefrontAppearance).mockReturnValue(storefrontAppearanceState as any)
    vi.mocked(useToast).mockReturnValue(toastMock as any)
    vi.mocked(useRoute).mockReturnValue({
      params: {},
      query: {},
    } as any)
    vi.mocked(useRouter).mockReturnValue({
      push: routerPush,
      replace: routerReplace,
    } as any)
    vi.mocked(categoryService.getAll).mockResolvedValue([
      { id: 1, name: 'Test Category', slug: 'test-category', description: '' },
    ] as any)
    vi.mocked(deliveryRegionService.getActive).mockResolvedValue([
      {
        id: 1,
        name: 'Centro',
        city: 'Salvador',
        neighborhoods: '',
        delivery_fee: '12.00',
        is_active: true,
      },
    ])
    vi.mocked(storeSettingsService.getPublic).mockResolvedValue({
      whatsapp_phone_digits: '5579999999999',
      is_whatsapp_configured: true,
    })
    vi.mocked(storefrontAppearanceService.getPublicBanners).mockResolvedValue([])
    wrapper = mountView()
    await flushPromises()
    await nextTick()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('navigates to product details when a card requests it', async () => {
    const cardComponent = wrapper.findComponent(ProductCardStub)
    await cardComponent.vm.$emit('open-details', mockProduct)

    expect(routerPush).toHaveBeenCalledWith({
      name: 'public.product-details',
      params: { slug: 'test-product' },
    })
  })

  it('falls back to code-based storefront route when slug is missing but public_code exists', async () => {
    wrapper.unmount()

    vi.mocked(useRoute).mockReturnValue({
      params: { storeSlug: 'default' },
      query: {},
    } as any)

    searchState.products.value = [
      {
        ...mockProduct,
        slug: null,
        public_code: 'ABC123XYZ',
      },
    ]

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    const cardComponent = wrapper.findComponent(ProductCardStub)
    await cardComponent.vm.$emit('open-details', searchState.products.value[0])

    expect(routerPush).toHaveBeenCalledWith({
      name: 'public.store-product-by-code',
      params: { storeSlug: 'default', code: 'ABC123XYZ' },
    })
  })

  it('shows an info toast when neither slug nor public_code are available', async () => {
    wrapper.unmount()

    vi.mocked(useRoute).mockReturnValue({
      params: { storeSlug: 'default' },
      query: {},
    } as any)

    const productWithoutDetailKeys = {
      ...mockProduct,
      slug: null,
      public_code: '',
    }

    searchState.products.value = [productWithoutDetailKeys]

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    const cardComponent = wrapper.findComponent(ProductCardStub)
    await cardComponent.vm.$emit('open-details', productWithoutDetailKeys)

    expect(routerPush).not.toHaveBeenCalled()
    expect(toastMock.info).toHaveBeenCalledWith(
      'Nao foi possivel abrir os detalhes deste produto no momento.',
    )
  })

  it('renders catalog header and products', () => {
    expect(wrapper.text()).toContain('Catalogo premium')
    expect(wrapper.text()).toContain('Loja Principal')
    expect(wrapper.find('.product-card-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('Exibindo 1-1 de 1 produtos')
  })

  it('applies public appearance presets and renders the hero banner', async () => {
    wrapper.unmount()

    storefrontAppearanceState.appearance.value = buildPublicAppearance({
      hero_enabled: true,
      hero_image_desktop: 'https://example.com/banner-desktop.jpg',
      hero_image_mobile: 'https://example.com/banner-mobile.jpg',
      hero_alt_text: 'Colecao nova',
      hero_title: 'Nova colecao',
      hero_subtitle: 'Pecas selecionadas para hoje.',
      hero_cta_text: 'Ver oferta',
      hero_cta_url: 'https://example.com/oferta',
      card_style: 'elevated',
      radius_style: 'soft',
      density: 'compact',
      font_preset: 'editorial',
      motion_enabled: false,
      decoration_enabled: true,
      decoration_style: 'geometric',
    })

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    const shell = wrapper.find('.storefront-shell')
    expect(shell.attributes('data-card-style')).toBe('elevated')
    expect(shell.attributes('data-density')).toBe('compact')
    expect(shell.attributes('data-font-preset')).toBe('editorial')
    expect(shell.attributes('data-motion')).toBe('off')
    expect(shell.attributes('data-decoration')).toBe('geometric')
    expect(shell.attributes('style')).toContain('--store-secondary-base: #374151')
    expect(shell.attributes('style')).toContain('--store-radius-lg: 2rem')
    expect(shell.attributes('style')).toContain('--motion-base: 0ms')

    const hero = wrapper.find('[data-cy="storefront-hero-banner"]')
    expect(hero.exists()).toBe(true)
    expect(hero.find('img').attributes('src')).toBe('https://example.com/banner-desktop.jpg')
    expect(hero.find('img').attributes('alt')).toBe('Colecao nova')
    expect(hero.text()).toContain('Nova colecao')
    expect(hero.text()).toContain('Ver oferta')
  })

  it('renders public promotional banners from the storefront API', async () => {
    wrapper.unmount()
    vi.mocked(storefrontAppearanceService.getPublicBanners).mockResolvedValue([
      {
        image_url: 'https://cdn.example.com/promo.png',
        alt_text: 'Promocao relampago',
        title: 'Oferta relampago',
        subtitle: 'Somente hoje',
        cta_text: 'Ver ofertas',
        button_url: '/l/default/produtos?category=7',
        position: 0,
        status: 'active',
      },
    ])

    wrapper = mountView()
    await flushPromises()
    await nextTick()

    const promotions = wrapper.find('[data-cy="storefront-promotional-banners"]')
    expect(promotions.exists()).toBe(true)
    expect(promotions.find('img').attributes('src')).toBe('https://cdn.example.com/promo.png')
    expect(promotions.find('img').attributes('alt')).toBe('Promocao relampago')
    expect(promotions.text()).toContain('Oferta relampago')
    expect(promotions.text()).toContain('Ver ofertas')
    expect(storefrontAppearanceService.getPublicBanners).toHaveBeenCalledWith('default')
  })

  it('renders category shortcuts and cart drawer components', async () => {
    await wrapper.find('[aria-label="Abrir filtros"]').trigger('click')

    expect(wrapper.text()).toContain('Todas')
    expect(wrapper.find('.cart-drawer-stub').exists()).toBe(true)
  })

  it('keeps the typed search space so compound terms can be entered naturally', async () => {
    await wrapper
      .find('input[aria-label="Buscar produtos por nome"]')
      .setValue('camisa ')

    expect(searchState.updateFilters).toHaveBeenCalledWith({
      search: 'camisa ',
    })
  })

  it('shows the floating cart action after an item is added', async () => {
    expect(
      wrapper.find('[aria-label="Abrir carrinho com 1 item"]').exists(),
    ).toBe(false)

    cartState.itemCount.value = 1
    await nextTick()

    const floatingCartButton = wrapper.find(
      '[aria-label="Abrir carrinho com 1 item"]',
    )
    expect(floatingCartButton.exists()).toBe(true)

    await floatingCartButton.trigger('click')

    expect(wrapper.findComponent(CartDrawerStub).props('isOpen')).toBe(true)
  })

  it('stages a quick category pick without applying it until "Ver resultados"', async () => {
    await wrapper.find('[aria-label="Abrir filtros"]').trigger('click')

    const categoryButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Test Category')

    expect(categoryButton).toBeDefined()

    await categoryButton!.trigger('click')

    expect(searchState.updateFilters).not.toHaveBeenCalled()

    const applyButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Ver resultados'))
    await applyButton!.trigger('click')

    expect(searchState.updateFilters).toHaveBeenCalledWith({
      categoryId: 1,
      inStockOnly: false,
    })
  })

  it('stages the in-stock checkbox without applying it until "Ver resultados"', async () => {
    await wrapper.find('[aria-label="Abrir filtros"]').trigger('click')

    const stockCheckbox = wrapper.find('input[type="checkbox"]')
    expect(stockCheckbox.exists()).toBe(true)

    await stockCheckbox.setValue(true)

    expect(searchState.updateFilters).not.toHaveBeenCalled()

    const applyButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Ver resultados'))
    await applyButton!.trigger('click')

    expect(searchState.updateFilters).toHaveBeenCalledWith({
      categoryId: undefined,
      inStockOnly: true,
    })
  })

  it('only changes page when the pagination widget is clicked, not on its own', async () => {
    // Pagination is click-driven only -- no scroll/IntersectionObserver
    // auto-load fighting the widget for control of `page`/`products`.
    searchState.totalPages.value = 3
    await nextTick()

    await wrapper.findComponent(ProductPaginationStub).vm.$emit('go-to-page', 2)
    expect(searchState.goToPage).toHaveBeenCalledWith(2)

    await wrapper.findComponent(ProductPaginationStub).vm.$emit('next-page')
    expect(searchState.nextPage).toHaveBeenCalled()

    await wrapper.findComponent(ProductPaginationStub).vm.$emit('previous-page')
    expect(searchState.previousPage).toHaveBeenCalled()

    searchState.totalPages.value = 1
  })

  it('discards staged filter changes when the sheet is dismissed', async () => {
    await wrapper.find('[aria-label="Abrir filtros"]').trigger('click')

    const stockCheckbox = wrapper.find('input[type="checkbox"]')
    await stockCheckbox.setValue(true)

    await wrapper.find('[aria-label="Fechar filtros"]').trigger('click')

    expect(searchState.updateFilters).not.toHaveBeenCalled()
    expect(
      wrapper.find('[aria-label="Abrir filtros"]').attributes('aria-expanded'),
    ).toBe('false')
  })

  it('adds product to cart and shows toast feedback', async () => {
    const cardComponent = wrapper.findComponent(ProductCardStub)
    await cardComponent.vm.$emit('add-to-cart', mockProducts[0], 2)

    expect(cartState.addItem).toHaveBeenCalledWith(mockProducts[0], 2)
    expect(toastMock.success).toHaveBeenCalled()
  })

  it('renders empty state when no products are available', async () => {
    searchState.products.value = []
    await nextTick()

    expect(wrapper.text()).toContain('Nenhum produto encontrado')
  })
})
