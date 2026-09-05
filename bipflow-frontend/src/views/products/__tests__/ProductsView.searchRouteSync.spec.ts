import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import {
  createRouter,
  createMemoryHistory,
  RouterView,
  type Router,
  type RouteRecordRaw,
} from 'vue-router'
import ProductsView from '../ProductsView.vue'
import productService from '@/services/product.service'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { useCustomerFeedback } from '@/composables/useCustomerFeedback'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useToast } from '@/composables/useToast'
import { categoryService } from '@/services/category.service'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { storeSettingsService } from '@/services/store-settings.service'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { PaginatedProductsResponse, ProductFilters } from '@/types/product'

vi.mock('@/services/product.service', () => ({
  default: { list: vi.fn() },
}))
vi.mock('@/composables/useCart', () => ({ useCart: vi.fn() }))
vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/composables/useCustomerProfile', () => ({ useCustomerProfile: vi.fn() }))
vi.mock('@/composables/useCustomerFeedback', () => ({ useCustomerFeedback: vi.fn() }))
vi.mock('@/composables/usePublicStorefrontAppearance', () => ({
  usePublicStorefrontAppearance: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({ useToast: vi.fn() }))
vi.mock('@/services/auth.service', () => ({
  authService: { isAuthenticated: vi.fn(() => false) },
}))
vi.mock('@/services/category.service', () => ({
  categoryService: { getAll: vi.fn() },
}))
vi.mock('@/services/delivery-region.service', () => ({
  deliveryRegionService: { getActive: vi.fn() },
}))
vi.mock('@/services/store-settings.service', () => ({
  storeSettingsService: { getPublic: vi.fn() },
}))
vi.mock('@/services/storefront-appearance.service', () => ({
  storefrontAppearanceService: { getPublicBanners: vi.fn() },
}))
vi.mock('@/services/order.service', () => ({
  orderService: { checkoutViaWhatsApp: vi.fn() },
  extractCheckoutErrorMessage: vi.fn(() => 'erro'),
}))

const SEARCH_INPUT = 'input[aria-label="Buscar produtos por nome"]'

function pageResponse(overrides: Partial<PaginatedProductsResponse> = {}): PaginatedProductsResponse {
  return {
    count: 2,
    next: null,
    previous: null,
    page_size: 12,
    total_pages: 1,
    results: [
      { id: 1, name: 'Produto Demo E2E', slug: 'produto-demo-e2e', price: '29.90', created_at: '2026-01-01T00:00:00Z' } as never,
      { id: 2, name: 'Produto Variavel E2E', slug: 'produto-variavel-e2e', price: '50.00', created_at: '2026-01-02T00:00:00Z' } as never,
    ],
    ...overrides,
  }
}

const StubView = defineComponent({ name: 'StubView', render: () => h('div') })

const routes: RouteRecordRaw[] = [
  { path: '/l/:storeSlug/produtos', name: 'public.store-products', component: ProductsView },
  { path: '/l/:storeSlug/produtos/:slug', name: 'public.store-product-details', component: StubView },
]

function listCalls(): Array<Partial<ProductFilters>> {
  return vi.mocked(productService.list).mock.calls.map((call) => call[0] as Partial<ProductFilters>)
}

function lastListCall(): Partial<ProductFilters> | undefined {
  return listCalls().at(-1)
}

describe('ProductsView — search ⇄ route synchronisation (real router + real useProductSearch)', () => {
  let router: Router
  let wrapper: VueWrapper

  // ProductsView constructs useProductSearch with the default 300ms debounce.
  const searchDebounce = 300
  const settleSearch = () =>
    new Promise((resolve) => setTimeout(resolve, searchDebounce + 60))

  beforeEach(async () => {
    vi.clearAllMocks()

    vi.mocked(productService.list).mockResolvedValue(pageResponse())
    vi.mocked(useCart).mockReturnValue({
      items: ref([]),
      customer: ref({ deliveryMethod: 'delivery', deliveryRegionId: null }),
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
    } as never)
    vi.mocked(useCurrentStore).mockReturnValue({
      selectedStore: ref({ id: 1, name: 'Loja', slug: 'default' }),
      fetchCurrentStore: vi.fn().mockResolvedValue(undefined),
    } as never)
    vi.mocked(useCustomerProfile).mockReturnValue({
      profile: ref(null),
      fetchCustomerProfile: vi.fn().mockResolvedValue(undefined),
    } as never)
    vi.mocked(useCustomerFeedback).mockReturnValue({ open: vi.fn() } as never)
    vi.mocked(usePublicStorefrontAppearance).mockReturnValue({
      appearance: ref(null),
      isLoading: ref(false),
      loadError: ref(null),
      load: vi.fn(),
    } as never)
    vi.mocked(useToast).mockReturnValue({ success: vi.fn(), info: vi.fn(), error: vi.fn() } as never)
    vi.mocked(categoryService.getAll).mockResolvedValue([
      { id: 3, name: 'Camisetas', slug: 'camisetas' },
    ] as never)
    vi.mocked(deliveryRegionService.getActive).mockResolvedValue([] as never)
    vi.mocked(storeSettingsService.getPublic).mockResolvedValue({
      whatsapp_phone_digits: '5579999999999',
      is_whatsapp_configured: true,
    } as never)
    vi.mocked(storefrontAppearanceService.getPublicBanners).mockResolvedValue([] as never)

    router = createRouter({ history: createMemoryHistory(), routes })
    // Mirror the app router's async global guard, which turns every
    // router.replace() into a multi-microtask navigation.
    router.beforeEach(async () => {
      await Promise.resolve()
      return true
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  async function mountAt(fullPath: string) {
    await router.push(fullPath)
    await router.isReady()
    wrapper = mount(ProductsView, {
      global: {
        plugins: [router],
        stubs: {
          CartDrawer: true,
          CustomerProfileMenuButton: true,
          FeedbackTrigger: true,
          FloatingCartButton: true,
          ProductCard: true,
          ProductPagination: true,
        },
      },
    })
    await flushPromises()
    await settleSearch()
    await flushPromises()
  }

  async function type(term: string, { perKeystrokeSettle = true } = {}) {
    const input = wrapper.get(SEARCH_INPUT)
    for (let i = 1; i <= term.length; i += 1) {
      await input.setValue(term.slice(0, i))
      if (perKeystrokeSettle) {
        await flushPromises()
      } else {
        await nextTick()
      }
    }
    await settleSearch()
    await flushPromises()
  }

  async function clearSearch() {
    await wrapper.get(SEARCH_INPUT).setValue('')
    await flushPromises()
    await settleSearch()
    await flushPromises()
  }

  it('sends the typed term to the backend and reflects it in the URL', async () => {
    await mountAt('/l/default/produtos')
    vi.mocked(productService.list).mockClear()

    await type('Produto Variavel E2E')

    expect(lastListCall()?.search).toBe('Produto Variavel E2E')
    expect(router.currentRoute.value.query.search).toBe('Produto Variavel E2E')
  })

  it('under fast typing the FINAL value wins — no request goes out truncated or empty', async () => {
    await mountAt('/l/default/produtos')
    vi.mocked(productService.list).mockClear()

    await type('Produto Demo E2E', { perKeystrokeSettle: false })

    const searches = listCalls().map((f) => f.search)
    expect(searches.length).toBeGreaterThan(0)
    // every issued request that carried a term carried a PREFIX of the final
    // one (never a stale value from a later keystroke), and the last one is
    // the complete term.
    for (const s of searches) {
      if (s) expect('Produto Demo E2E'.startsWith(s)).toBe(true)
    }
    expect(lastListCall()?.search).toBe('Produto Demo E2E')
    expect(router.currentRoute.value.query.search).toBe('Produto Demo E2E')
  })

  it('a stale route echo arriving mid-typing does not overwrite the newer text', async () => {
    await mountAt('/l/default/produtos')
    vi.mocked(productService.list).mockClear()

    const input = wrapper.get(SEARCH_INPUT)
    await input.setValue('Pro')
    await nextTick()
    // Simulate the router finishing an earlier replace and echoing an
    // out-of-order, now-stale query while the customer keeps typing.
    await input.setValue('Produto D')
    router.replace({ query: { search: 'Pro' } }).catch(() => {})
    await input.setValue('Produto Demo E2E')
    await flushPromises()
    await settleSearch()
    await flushPromises()

    expect(lastListCall()?.search).toBe('Produto Demo E2E')
    expect(router.currentRoute.value.query.search).toBe('Produto Demo E2E')
    expect((wrapper.get(SEARCH_INPUT).element as HTMLInputElement).value).toBe('Produto Demo E2E')
  })

  it('clearing the search removes only ?search and keeps ?category', async () => {
    await mountAt('/l/default/produtos?category=3')
    expect(lastListCall()?.categoryId).toBe(3)
    vi.mocked(productService.list).mockClear()

    await type('bla')
    expect(router.currentRoute.value.query).toMatchObject({ search: 'bla', category: '3' })
    expect(lastListCall()).toMatchObject({ search: 'bla', categoryId: 3 })

    vi.mocked(productService.list).mockClear()
    await clearSearch()

    expect(router.currentRoute.value.query.search).toBeUndefined()
    expect(router.currentRoute.value.query.category).toBe('3')
    expect(lastListCall()?.categoryId).toBe(3)
    expect(lastListCall()?.search ?? '').toBe('')
  })

  it('navigating to a product while a search sync is in flight is not cancelled by the sync', async () => {
    await mountAt('/l/default/produtos')

    const input = wrapper.get(SEARCH_INPUT)
    await input.setValue('Produto')
    await nextTick()
    // the router.replace from syncRouteQuery is now pending; opening a product
    // must still win the navigation race.
    await router.push({
      name: 'public.store-product-details',
      params: { storeSlug: 'default', slug: 'produto-demo-e2e' },
    })
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('public.store-product-details')
  })

  it('adopts an external query change (deep link / promo link) that lands while already on the page', async () => {
    await mountAt('/l/default/produtos')
    await type('abc')
    expect(router.currentRoute.value.query.search).toBe('abc')
    vi.mocked(productService.list).mockClear()

    // A navigation the component did not initiate -- e.g. a promo banner link
    // to ?category=3 opened from within the storefront.
    await router.push('/l/default/produtos?category=3')
    await flushPromises()
    await settleSearch()
    await flushPromises()

    expect(lastListCall()?.categoryId).toBe(3)
    expect(lastListCall()?.search ?? '').toBe('')
    expect((wrapper.get(SEARCH_INPUT).element as HTMLInputElement).value).toBe('')
  })

  it('browser back after opening a product restores the search on the remounted catalog', async () => {
    const App = defineComponent({ render: () => h(RouterView) })
    await router.push('/l/default/produtos')
    await router.isReady()
    wrapper = mount(App, {
      global: {
        plugins: [router],
        stubs: {
          CartDrawer: true,
          CustomerProfileMenuButton: true,
          FeedbackTrigger: true,
          FloatingCartButton: true,
          ProductCard: true,
          ProductPagination: true,
        },
      },
    })
    await flushPromises()
    await settleSearch()
    await flushPromises()

    await type('abc')
    expect(router.currentRoute.value.query.search).toBe('abc')

    await router.push({
      name: 'public.store-product-details',
      params: { storeSlug: 'default', slug: 'produto-demo-e2e' },
    })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('public.store-product-details')

    vi.mocked(productService.list).mockClear()
    router.back()
    await flushPromises()
    await settleSearch()
    await flushPromises()

    expect(router.currentRoute.value.query.search).toBe('abc')
    expect((wrapper.get(SEARCH_INPUT).element as HTMLInputElement).value).toBe('abc')
    expect(lastListCall()?.search).toBe('abc')
  })
})
