import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { computed, nextTick, ref, type Ref } from 'vue'
import DashboardSettingsView from '@/views/dashboard/DashboardSettingsView.vue'
import StorefrontAppearanceTab from '../StorefrontAppearanceTab.vue'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useToast } from '@/composables/useToast'
import { categoryService } from '@/services/category.service'
import productService from '@/services/product.service'
import { storeService } from '@/services/store.service'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { Store, StorefrontAppearance, StorefrontBanner } from '@/types/store'

vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: vi.fn() }))
vi.mock('@/services/store.service', () => ({
  storeService: {
    updateAppearance: vi.fn(),
    updateCurrentAppearance: vi.fn(),
  },
}))
vi.mock('@/services/storefront-appearance.service', () => ({
  storefrontAppearanceService: {
    get: vi.fn(),
    update: vi.fn(),
    uploadMedia: vi.fn(),
    listBanners: vi.fn(),
    createBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteBanner: vi.fn(),
    reorderBanners: vi.fn(),
  },
}))
vi.mock('@/services/category.service', () => ({
  categoryService: {
    getAll: vi.fn(),
  },
}))
vi.mock('@/services/product.service', () => ({
  default: {
    getAll: vi.fn(),
  },
}))
vi.mock('@/services/logger', () => ({
  Logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function buildStore(overrides: Partial<Store> = {}): Store {
  return {
    id: 1,
    name: 'Loja A',
    slug: 'loja-a',
    logo_url: 'https://example.com/logo-a.png',
    display_name: '',
    tagline: 'Catalogo A',
    whatsapp_phone: '5571999990000',
    theme: {
      primary: '#05050A',
      accent: '#111827',
      background: '#FAFAFA',
      surface: '#FFFFFF',
      text: '#05050A',
      muted: '#6B7280',
    },
    is_active: true,
    status: 'active',
    receipt_exchange_policy: '',
    receipt_paper_format: '80mm',
    ...overrides,
  }
}

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
    id: 100,
    store_id: 1,
    placement: 'promotion',
    image_url: 'https://cdn.example.com/promo.png',
    image_url_mobile: '',
    alt_text: 'Banner promocional',
    title: 'Promocao',
    subtitle: 'Itens selecionados',
    cta_text: 'Ver ofertas',
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

describe('DashboardSettingsView storefront appearance tab', () => {
  it('renders and selects the storefront appearance tab', async () => {
    const wrapper = shallowMount(DashboardSettingsView)

    expect(wrapper.text()).toContain('Aparencia da vitrine')

    const tab = wrapper.find('[data-cy="settings-tab-aparencia"]')
    await tab.trigger('click')

    expect(tab.attributes('aria-selected')).toBe('true')
  })
})

describe('StorefrontAppearanceTab', () => {
  const toastState = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
  const fetchCurrentStore = vi.fn().mockResolvedValue(undefined)
  let selectedStore: Ref<Store | null>

  function mockCurrentStore(store: Store | null = buildStore()) {
    selectedStore = ref(store)
    vi.mocked(useCurrentStore).mockReturnValue({
      selectedStore,
      storefrontPath: computed(() => (
        selectedStore.value?.slug ? `/l/${selectedStore.value.slug}/produtos` : '/produtos'
      )),
      fetchCurrentStore,
    } as any)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:storefront-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    fetchCurrentStore.mockClear()
    mockCurrentStore()
    vi.mocked(useToast).mockReturnValue(toastState as any)
    vi.mocked(storefrontAppearanceService.get).mockResolvedValue(buildAppearance())
    vi.mocked(storefrontAppearanceService.update).mockImplementation((payload) => (
      Promise.resolve(buildAppearance(payload))
    ))
    vi.mocked(storefrontAppearanceService.uploadMedia).mockImplementation((kind, file) => (
      Promise.resolve({
        kind,
        url: `https://cdn.example.com/${file.name}`,
        path: `stores/1/storefront/${kind}/${file.name}`,
        size: file.size,
        content_type: file.type,
      })
    ))
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([])
    vi.mocked(storefrontAppearanceService.createBanner).mockImplementation((payload) => (
      Promise.resolve(buildBanner({
        ...payload,
        id: 101,
        store_id: 1,
        image_url: payload.image_url ?? 'https://cdn.example.com/promo.png',
        alt_text: payload.alt_text ?? '',
        title: payload.title ?? '',
        subtitle: payload.subtitle ?? '',
        cta_text: payload.cta_text ?? '',
        destination_type: payload.destination_type ?? 'none',
        destination_value: payload.destination_value ?? '',
        position: payload.position ?? 0,
        is_active: payload.is_active ?? true,
        starts_at: payload.starts_at ?? null,
        ends_at: payload.ends_at ?? null,
      }))
    ))
    vi.mocked(storefrontAppearanceService.updateBanner).mockImplementation((id, payload) => (
      Promise.resolve(buildBanner({ id, ...payload }))
    ))
    vi.mocked(storefrontAppearanceService.deleteBanner).mockResolvedValue(undefined)
    vi.mocked(storefrontAppearanceService.reorderBanners).mockImplementation((ids) => (
      Promise.resolve(ids.map((id, index) => buildBanner({ id, position: index })))
    ))
    vi.mocked(categoryService.getAll).mockResolvedValue([
      {
        id: 7,
        name: 'Promocoes',
        slug: 'promocoes',
        description: null,
        product_count: 1,
        children_count: 0,
      },
    ])
    vi.mocked(productService.getAll).mockResolvedValue([
      {
        id: 9,
        name: 'Produto destaque',
        slug: 'produto-destaque',
        category: { id: 7, name: 'Promocoes', slug: 'promocoes' },
        price: 10,
        stock_quantity: 5,
        is_available: true,
      } as any,
    ])
    vi.mocked(storeService.updateCurrentAppearance).mockImplementation((payload) => (
      Promise.resolve(buildStore({
        display_name: payload.display_name ?? '',
        logo_url: payload.logo_url ?? 'https://example.com/logo-a.png',
        tagline: payload.tagline ?? 'Catalogo A',
        theme: payload.theme ?? buildStore().theme,
      }))
    ))
  })

  async function selectFile(wrapper: ReturnType<typeof mount>, selector: string, file: File) {
    const input = wrapper.find(selector)
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    })
    await input.trigger('change')
  }

  it('shows loading while fetching the current store appearance', async () => {
    const deferred = createDeferred<StorefrontAppearance>()
    vi.mocked(storefrontAppearanceService.get).mockReturnValueOnce(deferred.promise)

    const wrapper = mount(StorefrontAppearanceTab)

    expect(wrapper.find('[data-cy="storefront-appearance-loading"]').exists()).toBe(true)
    expect(storefrontAppearanceService.get).toHaveBeenCalledWith()

    deferred.resolve(buildAppearance())
    await flushPromises()

    expect(wrapper.find('[data-cy="storefront-appearance-loading"]').exists()).toBe(false)
  })

  it('loads appearance into the identity form and opens the selected store storefront', async () => {
    vi.mocked(storefrontAppearanceService.get).mockResolvedValue(buildAppearance({
      secondary_color: '#FF00AA',
    }))

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    expect((wrapper.find('[data-cy="storefront-secondary-color"]').element as HTMLInputElement).value).toBe('#FF00AA')
    expect(wrapper.find('[data-cy="open-current-storefront-link"]').attributes('href')).toBe('/l/loja-a/produtos')
  })

  it('shows first setup progress when the store still uses defaults', async () => {
    mockCurrentStore(buildStore({
      logo_url: '',
      display_name: '',
      tagline: '',
      theme: {
        primary: '#05050A',
        accent: '#111827',
        background: '#FAFAFA',
        surface: '#FFFFFF',
        text: '#05050A',
        muted: '#6B7280',
      },
    }))
    vi.mocked(storefrontAppearanceService.get).mockResolvedValue(buildAppearance({
      secondary_color: '#111827',
    }))

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    expect(wrapper.find('[data-cy="storefront-first-setup-progress"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('0 de 4 concluidos')
    expect(wrapper.text()).toContain('Adicionar logo')
    expect(wrapper.text()).toContain('Escolher cores')
  })

  it('saves identity colors through the allowed store and appearance payloads', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-tagline"]').setValue('Nova vitrine')
    await wrapper.find('[data-cy="storefront-display-name"]').setValue('Boutique A')
    await wrapper.find('[data-cy="storefront-secondary-color"]').setValue('#00AAFF')
    await wrapper.find('[data-cy="btn-save-storefront-identity"]').trigger('click')
    await flushPromises()

    expect(storeService.updateCurrentAppearance).toHaveBeenCalledWith({
      display_name: 'Boutique A',
      tagline: 'Nova vitrine',
    })
    expect(storefrontAppearanceService.update).toHaveBeenCalledWith({
      secondary_color: '#00AAFF',
    })
    expect(fetchCurrentStore).toHaveBeenCalledWith(true)
    expect(toastState.success).toHaveBeenCalledWith('Aparencia da vitrine atualizada com sucesso.')
  })

  it('applies a centralized palette preset and persists its colors', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper
      .find('[data-cy="storefront-palette-preset"][data-palette-id="azul-profissional"]')
      .trigger('click')
    await wrapper.find('[data-cy="btn-save-storefront-identity"]').trigger('click')
    await flushPromises()

    expect(storeService.updateCurrentAppearance).toHaveBeenCalledWith({
      theme: {
        primary: '#0F172A',
        accent: '#2563EB',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        text: '#0F172A',
        muted: '#64748B',
      },
    })
    expect(storefrontAppearanceService.update).toHaveBeenCalledWith({
      secondary_color: '#38BDF8',
    })
  })

  it('warns about low contrast and can fix the palette locally', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-theme-background"]').setValue('#000000')
    await wrapper.find('[data-cy="storefront-theme-text"]').setValue('#111111')
    await nextTick()

    expect(wrapper.find('[data-cy="storefront-contrast-panel"]').text()).toContain('Baixo contraste')

    await wrapper.find('[data-cy="btn-fix-storefront-contrast"]').trigger('click')
    await nextTick()

    expect((wrapper.find('[data-cy="storefront-theme-text"]').element as HTMLInputElement).value).toBe('#FFFFFF')
    expect(toastState.info).toHaveBeenCalledWith('Cores ajustadas para melhorar o contraste.')
  })

  it('previews and uploads a selected logo before saving the store identity', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    const logoFile = new File(['image'], 'logo.png', { type: 'image/png' })
    await selectFile(wrapper, '[data-cy="storefront-logo-file"]', logoFile)

    expect(wrapper.find('[data-cy="storefront-logo-preview"]').attributes('src')).toBe('blob:storefront-preview')

    await wrapper.find('[data-cy="btn-save-storefront-identity"]').trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.uploadMedia).toHaveBeenCalledWith('logo', logoFile)
    expect(storeService.updateCurrentAppearance).toHaveBeenCalledWith({
      logo_url: 'https://cdn.example.com/logo.png',
    })
    expect(fetchCurrentStore).toHaveBeenCalledWith(true)
  })

  it('previews and uploads a selected favicon before saving appearance', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    const faviconFile = new File(['image'], 'favicon.png', { type: 'image/png' })
    await selectFile(wrapper, '[data-cy="storefront-favicon-file"]', faviconFile)

    expect(wrapper.find('[data-cy="storefront-favicon-preview"]').attributes('src')).toBe('blob:storefront-preview')

    await wrapper.find('[data-cy="btn-save-storefront-identity"]').trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.uploadMedia).toHaveBeenCalledWith('favicon', faviconFile)
    expect(storefrontAppearanceService.update).toHaveBeenCalledWith({
      favicon_url: 'https://cdn.example.com/favicon.png',
    })
  })

  it('keeps banner fields conditional and saves the hero payload', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-banner"]').trigger('click')

    expect(wrapper.find('[data-cy="storefront-banner-file"]').exists()).toBe(false)

    await wrapper.find('[data-cy="storefront-banner-enabled"]').setValue(true)
    const bannerFile = new File(['image'], 'banner.png', { type: 'image/png' })
    await selectFile(wrapper, '[data-cy="storefront-banner-file"]', bannerFile)
    await wrapper.find('[data-cy="storefront-banner-alt"]').setValue('Campanha de verao')
    await wrapper.find('[data-cy="btn-save-storefront-banner"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="storefront-banner-preview"]').exists()).toBe(true)
    expect(storefrontAppearanceService.uploadMedia).toHaveBeenCalledWith('banner', bannerFile)
    expect(storefrontAppearanceService.update).toHaveBeenCalledWith(expect.objectContaining({
      hero_enabled: true,
      hero_image_desktop: 'https://cdn.example.com/banner.png',
      hero_alt_text: 'Campanha de verao',
    }))
    expect(toastState.success).toHaveBeenCalledWith('Aparencia da vitrine atualizada com sucesso.')
  })

  it('saves the hero CTA through a friendly category destination', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-banner"]').trigger('click')
    await wrapper.find('[data-cy="storefront-banner-enabled"]').setValue(true)
    await wrapper.find('[data-cy="storefront-banner-cta-text"]').setValue('Ver promocoes')
    await wrapper.find('[data-cy="storefront-banner-destination-type"]').setValue('category')
    await nextTick()
    await wrapper.find('[data-cy="storefront-banner-destination-category"]').setValue('7')
    await wrapper.find('[data-cy="btn-save-storefront-banner"]').trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.update).toHaveBeenCalledWith(expect.objectContaining({
      hero_destination_type: 'category',
      hero_destination_value: '7',
      hero_cta_text: 'Ver promocoes',
    }))
    expect(storefrontAppearanceService.update).not.toHaveBeenCalledWith(expect.objectContaining({
      hero_cta_url: expect.any(String),
    }))
  })

  it('creates a promotional banner with upload, product destination and schedule', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-promocoes"]').trigger('click')
    await wrapper.find('[data-cy="btn-add-storefront-promotion"]').trigger('click')

    const promotionFile = new File(['image'], 'promo.png', { type: 'image/png' })
    await selectFile(wrapper, '[data-cy="storefront-promotion-file"]', promotionFile)
    expect(wrapper.find('[data-cy="storefront-promotion-preview"]').attributes('src')).toBe('blob:storefront-preview')
    await wrapper.find('[data-cy="storefront-promotion-title"]').setValue('Oferta relampago')
    await wrapper.find('[data-cy="storefront-promotion-destination-type"]').setValue('product')
    await nextTick()
    await wrapper.find('[data-cy="storefront-promotion-destination-product"]').setValue('9')
    await wrapper.find('[data-cy="storefront-promotion-starts-at"]').setValue('2026-08-25T09:30')
    await wrapper.find('[data-cy="storefront-promotion-ends-at"]').setValue('2026-08-31T22:00')
    await wrapper.find('[data-cy="btn-save-storefront-promotion"]').trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.uploadMedia).toHaveBeenCalledWith('promotion', promotionFile)
    expect(storefrontAppearanceService.createBanner).toHaveBeenCalledWith(expect.objectContaining({
      image_url: 'https://cdn.example.com/promo.png',
      title: 'Oferta relampago',
      destination_type: 'product',
      destination_value: '9',
      is_active: true,
      starts_at: expect.any(String),
      ends_at: expect.any(String),
    }))
  })

  it('duplicates an existing promotional banner as a new draft', async () => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([
      buildBanner({ id: 100, title: 'Promocao', position: 0 }),
    ])

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-promocoes"]').trigger('click')
    await wrapper.find('[data-cy="btn-duplicate-storefront-promotion"]').trigger('click')
    await nextTick()

    expect(wrapper.findAll('[data-cy="storefront-promotion-card"]')).toHaveLength(2)
    expect(wrapper.find('[data-cy="storefront-promotion-drawer"]').exists()).toBe(true)
    expect((wrapper.find('[data-cy="storefront-promotion-title"]').element as HTMLInputElement).value).toBe('Promocao copia')
    expect(toastState.info).toHaveBeenCalledWith('Promocao duplicada como rascunho.')
  })

  it('switches the live preview between desktop and mobile modes', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-preview-mobile"]').trigger('click')

    expect(wrapper.find('[data-cy="storefront-preview-mobile"]').classes()).toContain('bg-white')
    expect(wrapper.find('[data-cy="storefront-preview-desktop"]').classes()).not.toContain('bg-white')
  })

  it('reorders persisted promotional banners', async () => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([
      buildBanner({ id: 100, title: 'Primeiro', position: 0 }),
      buildBanner({ id: 101, title: 'Segundo', position: 1 }),
    ])

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-promocoes"]').trigger('click')
    await wrapper.findAll('[data-cy="btn-move-storefront-promotion-down"]')[0]!.trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.reorderBanners).toHaveBeenCalledWith([101, 100])
  })

  it('disables the banner save button while the request is in flight', async () => {
    const deferred = createDeferred<StorefrontAppearance>()
    vi.mocked(storefrontAppearanceService.update).mockReturnValueOnce(deferred.promise)

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()
    await wrapper.find('[data-cy="storefront-appearance-section-banner"]').trigger('click')
    await wrapper.find('[data-cy="storefront-banner-enabled"]').setValue(true)

    const saveButton = wrapper.find('[data-cy="btn-save-storefront-banner"]')
    await saveButton.trigger('click')

    expect(saveButton.attributes('disabled')).toBeDefined()
    expect(saveButton.text()).toBe('Salvando...')

    deferred.resolve(buildAppearance({ hero_enabled: true }))
    await flushPromises()

    expect(saveButton.attributes('disabled')).toBeDefined()
  })

  it('shows an error when the appearance PATCH fails', async () => {
    vi.mocked(storefrontAppearanceService.update).mockRejectedValueOnce(new Error('network down'))

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()
    await wrapper.find('[data-cy="storefront-appearance-section-banner"]').trigger('click')
    await wrapper.find('[data-cy="storefront-banner-enabled"]').setValue(true)
    await wrapper.find('[data-cy="btn-save-storefront-banner"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Nao foi possivel salvar o banner. Tente novamente.')
    expect(toastState.error).toHaveBeenCalledWith('Nao foi possivel salvar o banner.')
  })

  it('saves layout, motion and decoration presets accepted by the backend', async () => {
    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    await wrapper.find('[data-cy="storefront-appearance-section-estilo"]').trigger('click')
    await wrapper.find('[data-cy="storefront-card-style-select"]').setValue('bordered')
    await wrapper.find('[data-cy="storefront-radius-style-select"]').setValue('soft')
    await wrapper.find('[data-cy="storefront-density-select"]').setValue('compact')
    await wrapper.find('[data-cy="storefront-font-preset-select"]').setValue('editorial')
    await wrapper.find('[data-cy="storefront-motion-intensity-select"]').setValue('subtle')
    await wrapper.find('[data-cy="storefront-decoration-enabled"]').setValue(true)
    await wrapper.find('[data-cy="storefront-decoration-style-select"]').setValue('geometric')
    await wrapper.find('[data-cy="btn-save-storefront-layout"]').trigger('click')
    await flushPromises()

    expect(storefrontAppearanceService.update).toHaveBeenCalledWith(expect.objectContaining({
      card_style: 'bordered',
      radius_style: 'soft',
      density: 'compact',
      font_preset: 'editorial',
      motion_enabled: true,
      motion_intensity: 'subtle',
      decoration_enabled: true,
      decoration_style: 'geometric',
    }))
  })

  it('reloads appearance when the selected store changes and replaces the previous form state', async () => {
    vi.mocked(storefrontAppearanceService.get)
      .mockResolvedValueOnce(buildAppearance({ secondary_color: '#FF00AA' }))
      .mockResolvedValueOnce(buildAppearance({ id: 20, store_id: 2, secondary_color: '#0044FF' }))

    const wrapper = mount(StorefrontAppearanceTab)
    await flushPromises()

    expect((wrapper.find('[data-cy="storefront-secondary-color"]').element as HTMLInputElement).value).toBe('#FF00AA')

    selectedStore.value = buildStore({
      id: 2,
      name: 'Loja B',
      slug: 'loja-b',
      logo_url: 'https://example.com/logo-b.png',
      tagline: 'Catalogo B',
    })
    await nextTick()
    await flushPromises()

    expect(storefrontAppearanceService.get).toHaveBeenCalledTimes(2)
    expect((wrapper.find('[data-cy="storefront-secondary-color"]').element as HTMLInputElement).value).toBe('#0044FF')
    expect(wrapper.find('[data-cy="open-current-storefront-link"]').attributes('href')).toBe('/l/loja-b/produtos')
  })

  it('ignores a stale Store A response that resolves after Store B', async () => {
    const storeARequest = createDeferred<StorefrontAppearance>()
    const storeBRequest = createDeferred<StorefrontAppearance>()
    vi.mocked(storefrontAppearanceService.get)
      .mockReturnValueOnce(storeARequest.promise)
      .mockReturnValueOnce(storeBRequest.promise)

    const wrapper = mount(StorefrontAppearanceTab)

    selectedStore.value = buildStore({ id: 2, name: 'Loja B', slug: 'loja-b' })
    await nextTick()

    storeBRequest.resolve(buildAppearance({ secondary_color: '#0044FF' }))
    await flushPromises()
    expect((wrapper.find('[data-cy="storefront-secondary-color"]').element as HTMLInputElement).value).toBe('#0044FF')

    storeARequest.resolve(buildAppearance({ secondary_color: '#FF00AA' }))
    await flushPromises()

    expect((wrapper.find('[data-cy="storefront-secondary-color"]').element as HTMLInputElement).value).toBe('#0044FF')
  })
})
