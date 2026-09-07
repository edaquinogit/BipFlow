<template>
  <div
    class="storefront-shell min-h-screen"
    :data-card-style="storefrontAppearance?.card_style ?? 'clean'"
    :data-density="storefrontAppearance?.density ?? 'comfortable'"
    :data-font-preset="storefrontAppearance?.font_preset ?? 'modern'"
    :data-motion="storefrontAppearance?.motion_enabled === false ? 'off' : 'on'"
    :data-motion-intensity="storefrontAppearance?.motion_intensity ?? 'standard'"
    :data-decoration="storefrontAppearance?.decoration_enabled ? storefrontAppearance.decoration_style : 'none'"
    :style="storeBranding.cssVars"
  >
    <StorefrontHeader
      variant="catalog"
      :store-name="storeBranding.name"
      :logo-url="storeBranding.logoUrl"
      :catalog-to="catalogRoute"
      :search="filters.search"
      :item-count="itemCount"
      :subtotal="subtotal"
      :filters-open="isFiltersOpen"
      :active-filter-count="activeFilterCount"
      @update:search="updateFilters({ search: $event })"
      @open-cart="openCart"
      @toggle-filters="toggleFilters"
    >
      <template #account>
        <CustomerProfileMenuButton />
      </template>
    </StorefrontHeader>

    <!-- Filters: bottom sheet on mobile, centred sheet on larger screens -->
    <Transition name="sf-sheet">
      <div v-if="isFiltersOpen" class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-[var(--store-text)]/50" @click="handleCancelFilters" />

        <div
          ref="filtersSheetRef"
          role="dialog"
          aria-modal="true"
          aria-label="Filtrar produtos"
          class="sf-sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] max-w-lg flex-col rounded-t-[var(--store-radius-lg)] border-t border-[var(--store-border)] bg-[var(--store-surface)] shadow-[var(--shadow-sf-overlay)] sm:inset-x-4 sm:bottom-auto sm:top-[7vh] sm:max-h-[80vh] sm:rounded-[var(--store-radius-lg)] sm:border"
        >
          <header class="flex items-center justify-between gap-3 border-b border-[var(--store-border)] px-4 py-3 sm:px-5">
            <h2 class="text-base font-semibold text-[var(--store-text)]">Filtros</h2>
            <button
              ref="filtersCloseRef"
              type="button"
              class="storefront-icon-btn"
              aria-label="Fechar filtros"
              @click="handleCancelFilters"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
            <div>
              <label class="mb-1.5 block text-[0.8125rem] font-semibold text-[var(--store-text-muted)]" for="sf-sort">Ordenar por</label>
              <select
                id="sf-sort"
                v-model="sortBy"
                class="storefront-select"
              >
                <option value="featured">Mais relevantes</option>
                <option value="price-asc">Menor preço</option>
                <option value="price-desc">Maior preço</option>
                <option value="name-asc">Nome A-Z</option>
                <option value="newest">Mais recentes</option>
              </select>
            </div>

            <div>
              <p class="mb-1.5 text-[0.8125rem] font-semibold text-[var(--store-text-muted)]">Disponibilidade</p>
              <label class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-[var(--store-text)]">
                <input
                  type="checkbox"
                  :checked="draftInStockOnly"
                  class="h-4 w-4 rounded border-[var(--store-border)] text-[var(--store-brand-on-light)] focus:ring-[var(--store-brand-soft)]"
                  @change="handleStockFilterToggle"
                />
                Somente em estoque
              </label>
            </div>

            <div v-if="categories.length">
              <p class="mb-2 text-[0.8125rem] font-semibold text-[var(--store-text-muted)]">Categorias</p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="storefront-chip"
                  :class="{ 'storefront-chip--on': !draftCategoryId }"
                  :aria-pressed="!draftCategoryId"
                  @click="handleQuickCategory(undefined)"
                >
                  Todas
                </button>
                <button
                  v-for="category in categories"
                  :key="category.id"
                  type="button"
                  class="storefront-chip"
                  :class="{ 'storefront-chip--on': draftCategoryId === category.id }"
                  :aria-pressed="draftCategoryId === category.id"
                  @click="handleQuickCategory(category.id)"
                >
                  {{ category.name }}
                </button>
              </div>
            </div>
          </div>

          <footer class="flex items-center gap-2.5 border-t border-[var(--store-border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
            <StorefrontButton variant="ghost" class="shrink-0" @click="handleClearFilters">
              Limpar
            </StorefrontButton>
            <StorefrontButton class="flex-1" @click="handleSaveFilters">
              Ver resultados
            </StorefrontButton>
          </footer>
        </div>
      </div>
    </Transition>

    <main
      class="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8"
      :aria-busy="isLoading ? 'true' : 'false'"
      style="overflow-anchor: none"
    >
      <p class="sr-only" aria-live="polite">{{ liveRegionMessage }}</p>

      <HeroCarousel :banners="heroBanners" :store-name="storeBranding.name" />

      <PromotionsCarousel :promotions="promotionBanners" />

      <CategoryNav
        :categories="categories"
        :active-category-id="filters.categoryId"
        @select="handleCategorySelect"
      />

      <div class="mb-4 flex items-center justify-between gap-3 text-[0.8125rem] text-[var(--store-text-muted)] sm:mb-5">
        <p>{{ showingRange }}</p>
        <button
          v-if="filters.search || filters.categoryId || filters.inStockOnly"
          type="button"
          class="font-medium text-[var(--store-brand-on-light)] underline-offset-4 hover:underline"
          @click="handleClearFilters"
        >
          Limpar filtros
        </button>
      </div>

      <div
        v-if="isInitialLoading && products.length === 0"
        class="storefront-product-grid grid grid-cols-2 gap-x-2.5 gap-y-5 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-6 xl:grid-cols-4"
      >
        <div
          v-for="n in 8"
          :key="n"
          class="overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-surface)]"
        >
          <StorefrontSkeleton radius="sm" class="aspect-[4/5] w-full" />
          <div class="space-y-2 p-3 sm:p-3.5">
            <StorefrontSkeleton variant="text" width="40%" />
            <StorefrontSkeleton variant="text" width="85%" />
            <StorefrontSkeleton variant="text" width="55%" height="1.1rem" />
            <StorefrontSkeleton height="2.75rem" class="mt-1" />
          </div>
        </div>
      </div>

      <div
        v-else-if="error && products.length === 0"
        class="mx-auto max-w-sm py-16 text-center sm:py-20"
      >
        <h2 class="text-base font-semibold text-[var(--store-text)]">Não foi possível carregar os produtos</h2>
        <p class="mx-auto mt-2 text-[0.8125rem] leading-6 text-[var(--store-text-muted)]">{{ error }}</p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <StorefrontButton aria-label="Tentar novamente" @click="retryFetch">
            Tentar novamente
          </StorefrontButton>
          <StorefrontButton
            variant="ghost"
            aria-label="Relatar problema"
            @click="handleReportCatalogProblem"
          >
            Relatar problema
          </StorefrontButton>
        </div>
      </div>

      <div
        v-else-if="displayedProducts.length > 0"
        class="storefront-product-grid grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"
        :class="isCompactDensity
          ? 'gap-x-2 gap-y-3 sm:gap-x-3 sm:gap-y-4'
          : 'gap-x-2.5 gap-y-4 sm:gap-x-4 sm:gap-y-6'"
      >
        <ProductCard
          v-for="product in displayedProducts"
          :key="product.id"
          :product="product"
          :cart-quantity="getProductQuantity(product.id)"
          @add-to-cart="handleAddToCart"
          @open-details="handleOpenDetails"
        />
      </div>

      <div
        v-else
        data-cy="storefront-empty-state"
        class="mx-auto max-w-sm py-16 text-center sm:py-20"
      >
        <h2 class="text-base font-semibold text-[var(--store-text)]">{{ emptyStateTitle }}</h2>
        <p class="mx-auto mt-2 text-[0.8125rem] leading-6 text-[var(--store-text-muted)]">
          {{ emptyStateMessage }}
        </p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <StorefrontButton
            v-if="filters.categoryId"
            variant="outline"
            aria-label="Ver todos os produtos"
            @click="handleViewAllProducts"
          >
            Ver todos os produtos
          </StorefrontButton>
          <StorefrontButton
            v-if="filters.search || filters.categoryId || filters.inStockOnly"
            variant="outline"
            aria-label="Limpar filtros"
            @click="handleClearFilters"
          >
            Limpar filtros
          </StorefrontButton>
        </div>
      </div>

      <div v-if="totalPages > 1" class="mt-8">
        <ProductPagination
          :current-page="page"
          :total-pages="totalPages"
          :has-previous-page="hasPreviousPage"
          :has-next-page="hasNextPage"
          :showing-range="showingRange"
          @go-to-page="handleGoToPage"
          @next-page="nextPage"
          @previous-page="previousPage"
        />
      </div>

      <StorefrontFooter
        :store-name="storeBranding.name"
        :tagline="storeBranding.tagline"
        :merchant="storefrontAppearance?.merchant"
      >
        <template #feedback>
          <FeedbackTrigger />
        </template>
      </StorefrontFooter>
    </main>

    <FloatingCartButton
      :item-count="itemCount"
      @open-cart="openCart"
    />

    <CartDrawer
      :is-open="isCartOpen"
      :items="items"
      :item-count="itemCount"
      :subtotal="subtotal"
      :delivery-fee="deliveryFee"
      :total="total"
      :customer="customer"
      :delivery-regions="deliveryRegions"
      :is-delivery-regions-loading="isDeliveryRegionsLoading"
      :is-submitting="isSubmittingOrder"
      :is-whats-app-configured="isWhatsAppConfigured"
      :profile="customerProfile"
      @close="isCartOpen = false"
      @clear-cart="clearCart"
      @remove-item="removeItem"
      @update-quantity="updateQuantity"
      @update-customer="updateCustomer"
      @submit-order="handleSubmitOrder"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryValue } from 'vue-router'
import { PublicRoutes } from '@/router/public.routes'
import CartDrawer from './CartDrawer.vue'
import CustomerProfileMenuButton from './CustomerProfileMenuButton.vue'
import FloatingCartButton from './FloatingCartButton.vue'
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger.vue'
import CategoryNav from '@/components/storefront/CategoryNav.vue'
import HeroCarousel from '@/components/storefront/HeroCarousel.vue'
import PromotionsCarousel from '@/components/storefront/PromotionsCarousel.vue'
import StorefrontButton from '@/components/storefront/StorefrontButton.vue'
import StorefrontFooter from '@/components/storefront/StorefrontFooter.vue'
import StorefrontHeader from '@/components/storefront/StorefrontHeader.vue'
import StorefrontSkeleton from '@/components/storefront/StorefrontSkeleton.vue'
import ProductCard from './ProductCard.vue'
import ProductPagination from './ProductPagination.vue'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCustomerFeedback } from '@/composables/useCustomerFeedback'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { useProductSearch } from '@/composables/useProductSearch'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useStoreTheme } from '@/composables/useStoreTheme'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useStorefrontOverlay } from '@/composables/useStorefrontOverlay'
import { useStorefrontDocumentMeta } from '@/composables/useStorefrontDocumentMeta'
import { useToast } from '@/composables/useToast'
import type { Category } from '@/schemas/category.schema'
import { authService } from '@/services/auth.service'
import { categoryService } from '@/services/category.service'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { Logger } from '@/services/logger'
import { extractCheckoutErrorMessage, orderService } from '@/services/order.service'
import { setSelectedStoreSlug } from '@/services/store-scope'
import { storeSettingsService } from '@/services/store-settings.service'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { DeliveryRegion } from '@/types/delivery'
import { getErrorRequestId } from '@/types/errors'
import type {
  Product,
  ProductFilters as ProductFilterState,
  ProductSortOption,
  ProductVariant,
} from '@/types/product'
import type { PublicStorefrontBanner } from '@/types/store'
import { applyStorefrontFavicon } from '@/utils/storefrontFavicon'

function parseNumberParam(
  value: LocationQueryValue | LocationQueryValue[] | undefined
): number | undefined {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  if (typeof normalizedValue !== 'string' || normalizedValue.trim() === '') {
    return undefined
  }

  const parsedValue = Number(normalizedValue)
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined
}

function parseFiltersFromQuery(query: LocationQuery): ProductFilterState {
  return {
    search: typeof query.search === 'string' ? query.search : '',
    categoryId: parseNumberParam(query.category),
    priceMin: parseNumberParam(query.minPrice),
    priceMax: parseNumberParam(query.maxPrice),
    inStockOnly: query.inStockOnly === 'true',
  }
}

function parsePageFromQuery(query: LocationQuery): number {
  const parsedPage = parseNumberParam(query.page)
  return parsedPage && parsedPage >= 1 ? parsedPage : 1
}

const route = useRoute()
const router = useRouter()
const routeStoreSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
if (routeStoreSlug) {
  setSelectedStoreSlug(routeStoreSlug)
}
const currentRouteStoreSlug = computed(() => (
  typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
))
const toast = useToast()
const { open: openFeedback } = useCustomerFeedback()
const { profile: customerProfile, fetchCustomerProfile } = useCustomerProfile()
const { selectedStore, fetchCurrentStore } = useCurrentStore()
const publicStoreSlug = computed(() => currentRouteStoreSlug.value || selectedStore.value?.slug || null)
const { appearance: storefrontAppearance } = usePublicStorefrontAppearance(publicStoreSlug)
const storeBranding = useStoreTheme(selectedStore, storefrontAppearance)

// Per-store document metadata, restored to generic values on leaving the
// storefront so another area never inherits this store's name.
useStorefrontDocumentMeta({
  storeName: computed(() => (selectedStore.value ? storeBranding.value.name : null)),
  description: computed(
    () => storefrontAppearance.value?.tagline || storeBranding.value.tagline || null,
  ),
})

const catalogRoute = computed(() => {
  const storeSlug = currentRouteStoreSlug.value
  return storeSlug
    ? { name: PublicRoutes.StoreProducts, params: { storeSlug } }
    : { name: PublicRoutes.Products }
})

const categories = ref<Category[]>([])
const storefrontBanners = ref<PublicStorefrontBanner[]>([])
const deliveryRegions = ref<DeliveryRegion[]>([])
const storeWhatsAppPhone = ref('')
const isCartOpen = ref(false)

// Guest checkout reinstated: CartDrawer needs a fresh profile (or null) at
// render time to decide which fields to show, so refresh it whenever the
// cart opens -- covers switching stores mid-SPA-session without a reload.
// authService.isAuthenticated() guard matches CustomerProfileMenuButton's
// own pattern, so an anonymous visitor never fires a doomed 401 fetch.
function openCart(): void {
  isCartOpen.value = true
  if (authService.isAuthenticated()) {
    void fetchCustomerProfile()
  }
}

const isSubmittingOrder = ref(false)
const isDeliveryRegionsLoading = ref(false)
const sortBy = ref<ProductSortOption>('featured')
const isFiltersOpen = ref(false)
const draftCategoryId = ref<number | undefined>(undefined)
const draftInStockOnly = ref(false)
const filtersSheetRef = ref<HTMLElement | null>(null)
const filtersCloseRef = ref<HTMLElement | null>(null)
useDialogA11y(isFiltersOpen, () => handleCancelFilters(), filtersSheetRef, filtersCloseRef)
// Registers the overlay: locks body scroll and moves the toast host aside.
useStorefrontOverlay(isFiltersOpen)

const initialFilters = parseFiltersFromQuery(route.query)
const initialPage = parsePageFromQuery(route.query)

const {
  products,
  isLoading,
  isInitialLoading,
  error,
  errorCorrelationId,
  page,
  totalPages,
  filters,
  hasNextPage,
  hasPreviousPage,
  showingRange,
  fetchProducts,
  updateFilters,
  clearFilters,
  goToPage,
  nextPage,
  previousPage,
} = useProductSearch({
  initialFilters,
  initialPage,
})

const {
  items,
  customer,
  itemCount,
  subtotal,
  deliveryFee,
  total,
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  updateCustomer,
  resetCustomer,
  getProductQuantity,
} = useCart()

// The URL query is a downstream projection of `filters` + `page` while this
// view is mounted -- the component owns that state and pushes every change out
// with `router.replace`. The URL is only read *back* into the filters on a
// navigation the component did not itself initiate (a browser back/forward, or
// a deep link opened while already on this page).
//
// `pendingRouteWrites` holds the serialized queries we have asked the router to
// write and not yet seen echoed through the `route.query` watcher. It replaces
// a single `isSyncingRouteState` boolean that was set synchronously and cleared
// in an async `.finally`: with overlapping `router.replace` calls during fast
// typing (each navigation also awaits an async `beforeEach` guard) that boolean
// could be back down when an *earlier* replace's echo finally arrived, so the
// route watcher adopted a stale query and overwrote text the user had since
// typed -- intermittently firing the catalog request with a truncated search
// term or none at all, and, when the echo cascaded into a fresh `router.replace`
// mid-click, cancelling the navigation to the product being opened. Matching on
// the exact query string is order-independent, so none of that can happen.
const pendingRouteWrites = new Set<string>()

function serializeQuery(query: LocationQuery | Record<string, string>): string {
  const entries = Object.entries(query)
    .map(([key, value]) => {
      const normalized = Array.isArray(value) ? value[0] : value
      return [key, normalized == null ? '' : String(normalized)] as const
    })
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return JSON.stringify(entries)
}

const displayedProducts = computed(() => {
  const nextProducts = [...products.value]

  switch (sortBy.value) {
    case 'price-asc':
      return nextProducts.sort((left, right) => Number(left.price) - Number(right.price))
    case 'price-desc':
      return nextProducts.sort((left, right) => Number(right.price) - Number(left.price))
    case 'name-asc':
      return nextProducts.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    case 'newest':
      return nextProducts.sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      )
    default:
      return nextProducts
  }
})

const selectedCategoryName = computed(
  () => categories.value.find((category) => category.id === filters.value.categoryId)?.name ?? null,
)

const emptyStateTitle = computed(() => {
  if (filters.value.categoryId) {
    return selectedCategoryName.value
      ? `Nenhum produto em ${selectedCategoryName.value}`
      : 'Nenhum produto nesta categoria'
  }
  return 'Nenhum produto encontrado'
})

const emptyStateMessage = computed(() => {
  if (filters.value.search) {
    return `Nada corresponde a "${filters.value.search}".`
  }
  if (filters.value.categoryId) {
    return 'Ainda nao ha produtos visiveis nesta categoria.'
  }
  return 'Tente outra categoria ou remova os filtros.'
})

function handleViewAllProducts(): void {
  updateFilters({ categoryId: undefined })
}

const isWhatsAppConfigured = computed(() => storeWhatsAppPhone.value.length > 0)
const isCompactDensity = computed(() => storefrontAppearance.value?.density === 'compact')

// Applied filters other than free-text search, shown as a discreet count
// on the header's filter trigger.
const activeFilterCount = computed(
  () => (filters.value.categoryId ? 1 : 0) + (filters.value.inStockOnly ? 1 : 0),
)

// Ciclo 9: the hero carousel reads from the placement-scoped banner list.
// A store that never touched the new multi-banner admin UI keeps working
// through the legacy single hero_* image -- rendered as a one-slide
// "carousel" (no controls/autoplay, same as any single hero banner) so nothing
// a merchant already configured disappears. Once at least one hero-placement
// banner exists, that list takes over entirely.
const heroBannersFromApi = computed(() =>
  storefrontBanners.value.filter((banner) => banner.placement === 'hero'),
)
const legacyHeroBanner = computed<PublicStorefrontBanner | null>(() => {
  const appearance = storefrontAppearance.value
  if (!appearance?.hero_enabled || !appearance.hero_image_desktop) {
    return null
  }

  return {
    placement: 'hero',
    image_url: appearance.hero_image_desktop,
    image_url_mobile: appearance.hero_image_mobile,
    alt_text: appearance.hero_alt_text,
    title: appearance.hero_title,
    subtitle: appearance.hero_subtitle,
    cta_text: appearance.hero_cta_text,
    button_url: appearance.hero_cta_url,
    position: 0,
    status: 'active',
  }
})
const heroBanners = computed(() =>
  heroBannersFromApi.value.length
    ? heroBannersFromApi.value
    : legacyHeroBanner.value
      ? [legacyHeroBanner.value]
      : [],
)
const promotionBanners = computed(() =>
  storefrontBanners.value.filter((banner) => banner.placement === 'promotion'),
)

const liveRegionMessage = computed(() => {
  if (isInitialLoading.value) {
    return 'Carregando produtos.'
  }

  if (error.value) {
    return `Erro ao carregar produtos: ${error.value}`
  }

  if (products.value.length === 0) {
    return 'Nenhum produto encontrado.'
  }

  return `${products.value.length} produtos exibidos. ${showingRange.value}`
})

function buildQueryFromState(): Record<string, string> {
  const query: Record<string, string> = {}

  if (filters.value.search?.trim()) {
    query.search = filters.value.search.trim()
  }

  if (filters.value.categoryId) {
    query.category = String(filters.value.categoryId)
  }

  if (filters.value.priceMin !== undefined) {
    query.minPrice = String(filters.value.priceMin)
  }

  if (filters.value.priceMax !== undefined) {
    query.maxPrice = String(filters.value.priceMax)
  }

  if (filters.value.inStockOnly) {
    query.inStockOnly = 'true'
  }

  if (page.value > 1) {
    query.page = String(page.value)
  }

  return query
}

function syncRouteQuery(): void {
  const nextQuery = buildQueryFromState()
  const nextKey = serializeQuery(nextQuery)

  if (serializeQuery(route.query) === nextKey) {
    return
  }

  pendingRouteWrites.add(nextKey)
  router
    .replace({ query: nextQuery })
    .catch(() => {
      // A newer navigation (e.g. opening a product) supersedes this replace --
      // expected during fast interaction, not an error worth surfacing.
    })
    .finally(() => {
      pendingRouteWrites.delete(nextKey)
    })
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = await categoryService.getAll()
  } catch (err) {
    categories.value = []
    Logger.warn('Failed to load public categories', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  }
}

async function loadStoreSettings(): Promise<void> {
  try {
    const settings = await storeSettingsService.getPublic()
    storeWhatsAppPhone.value = settings.whatsapp_phone_digits
  } catch (err) {
    storeWhatsAppPhone.value = ''
    Logger.warn('Failed to load public store settings', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  }
}

async function loadStorefrontBanners(): Promise<void> {
  const slug = publicStoreSlug.value
  if (!slug) {
    storefrontBanners.value = []
    return
  }

  try {
    storefrontBanners.value = await storefrontAppearanceService.getPublicBanners(slug)
  } catch (err) {
    storefrontBanners.value = []
    Logger.warn('Failed to load public storefront banners', {
      error: err instanceof Error ? err.message : 'unknown_error',
      slug,
    })
  }
}

async function loadDeliveryRegions(): Promise<void> {
  isDeliveryRegionsLoading.value = true

  try {
    deliveryRegions.value = await deliveryRegionService.getActive()

    const selectedRegion = deliveryRegions.value.find(
      (region) => region.id === customer.value.deliveryRegionId
    )

    if (customer.value.deliveryRegionId && !selectedRegion) {
      updateCustomer({
        deliveryRegionId: null,
        deliveryRegionName: '',
        deliveryRegionFee: 0,
      })
    }

    if (
      customer.value.deliveryMethod === 'delivery'
      && !customer.value.deliveryRegionId
      && deliveryRegions.value.length === 1
    ) {
      const [region] = deliveryRegions.value
      if (!region) {
        return
      }

      updateCustomer({
        deliveryRegionId: region.id,
        deliveryRegionName: region.name,
        deliveryRegionFee: Number(region.delivery_fee),
      })
    }
  } catch (err) {
    deliveryRegions.value = []
    Logger.warn('Failed to load public delivery regions', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  } finally {
    isDeliveryRegionsLoading.value = false
  }
}

watch(
  () => [
    filters.value.search,
    filters.value.categoryId,
    filters.value.priceMin,
    filters.value.priceMax,
    filters.value.inStockOnly,
    page.value,
  ],
  () => {
    syncRouteQuery()
  }
)

watch(
  () => route.query,
  (query) => {
    const incomingKey = serializeQuery(query)

    // Our own write coming back around: the filters already reflect this query
    // (or a newer edit that flushes on its own). Consume the marker, stop.
    if (pendingRouteWrites.has(incomingKey)) {
      pendingRouteWrites.delete(incomingKey)
      return
    }

    // URL already matches the live state -- a redundant re-emit, or a write
    // that outran its marker being cleared. Nothing to adopt.
    if (serializeQuery(buildQueryFromState()) === incomingKey) {
      return
    }

    // Genuine external navigation (back/forward, or a deep link opened while
    // already on this page): the URL is now the source of truth.
    const nextFilters = parseFiltersFromQuery(query)
    const nextPageValue = parsePageFromQuery(query)

    if (JSON.stringify(filters.value) !== JSON.stringify(nextFilters)) {
      updateFilters(nextFilters)
      return
    }

    if (page.value !== nextPageValue) {
      goToPage(nextPageValue)
    }
  }
)

watch(
  () => route.params?.storeSlug,
  async (storeSlug) => {
    if (typeof storeSlug === 'string' && storeSlug.trim()) {
      setSelectedStoreSlug(storeSlug)
      await Promise.allSettled([
        fetchCurrentStore(true),
        loadCategories(),
        loadDeliveryRegions(),
        loadStoreSettings(),
        loadStorefrontBanners(),
        fetchProducts(),
      ])
    }
  }
)

watch(
  publicStoreSlug,
  () => {
    void loadStorefrontBanners()
  },
)

watch(
  () => storefrontAppearance.value?.favicon_url,
  (faviconUrl) => {
    applyStorefrontFavicon(faviconUrl)
  },
  { immediate: true },
)

onMounted(async () => {
  await Promise.allSettled([
    fetchCurrentStore(),
    loadCategories(),
    loadDeliveryRegions(),
    loadStoreSettings(),
    loadStorefrontBanners(),
  ])
})

// Standard "return focus to the trigger" pattern for a dialog/sheet: the
// element that opened it is whatever had focus right before -- normally the
// header's "Abrir filtros" button. useDialogA11y already moves focus *into*
// the sheet on open; closing it removes the sheet from the DOM, which would
// otherwise silently drop focus to <body> (a real keyboard-nav regression,
// separate from the scroll-jump bug this cycle also fixes).
let filtersTriggerElement: HTMLElement | null = null

function openFilters(): void {
  filtersTriggerElement = document.activeElement as HTMLElement | null
  draftCategoryId.value = filters.value.categoryId
  draftInStockOnly.value = filters.value.inStockOnly ?? false
  isFiltersOpen.value = true
}

function restoreFocusToFiltersTrigger(): void {
  filtersTriggerElement?.focus()
  filtersTriggerElement = null
}

function toggleFilters(): void {
  if (isFiltersOpen.value) {
    isFiltersOpen.value = false
    return
  }

  openFilters()
}

function handleQuickCategory(categoryId: number | undefined): void {
  draftCategoryId.value = categoryId
}

// The always-visible category bar (Ciclo 9) applies immediately, unlike the
// filters sheet's staged draft/"Ver resultados" flow -- selecting a category
// here is the whole action, so it writes straight to the live filter (which
// is already what drives the URL query and re-fetch).
function handleCategorySelect(categoryId: number | undefined): void {
  updateFilters({ categoryId })
}

function handleStockFilterToggle(event: Event): void {
  const target = event.target as HTMLInputElement
  draftInStockOnly.value = target.checked
}

function handleSaveFilters(): void {
  updateFilters({
    categoryId: draftCategoryId.value,
    inStockOnly: draftInStockOnly.value,
  })
  isFiltersOpen.value = false
  restoreFocusToFiltersTrigger()
}

function handleCancelFilters(): void {
  // Dismiss = discard staged changes; they re-sync from live filters on reopen.
  draftCategoryId.value = filters.value.categoryId
  draftInStockOnly.value = filters.value.inStockOnly ?? false
  isFiltersOpen.value = false
  restoreFocusToFiltersTrigger()
}

function handleClearFilters(): void {
  clearFilters()
  draftCategoryId.value = undefined
  draftInStockOnly.value = false
  isFiltersOpen.value = false
}

function handleGoToPage(pageNumber: number): void {
  goToPage(pageNumber)
}

function retryFetch(): void {
  void fetchProducts()
}

function handleReportCatalogProblem(): void {
  openFeedback({
    type: 'problem',
    pagePath: route.fullPath,
    correlationId: errorCorrelationId.value,
  })
}

function handleAddToCart(
  product: Product,
  quantity: number,
  variant: ProductVariant | null = null,
): void {
  if (variant) {
    addItem(product, quantity, variant)
  } else {
    addItem(product, quantity)
  }
  const variantLabel = variant?.name ? ` - ${variant.name}` : ''
  // Ciclo 8: dedup key so 3 quick adds (same or different products) update
  // one toast in place instead of stacking on top of the item list.
  toast.success(`${quantity} unidade(s) de ${product.name}${variantLabel} adicionada(s) ao pedido.`, undefined, 'cart-add')
}

function handleOpenDetails(product: Product): void {
  const storeSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
  const normalizedSlug = (product.slug || '').trim()
  const normalizedPublicCode = (product.public_code || '').trim()

  if (normalizedSlug) {
    void router.push({
      name: storeSlug ? PublicRoutes.StoreProductDetails : PublicRoutes.ProductDetails,
      params: storeSlug ? { storeSlug, slug: normalizedSlug } : { slug: normalizedSlug },
    })
    return
  }

  if (storeSlug && normalizedPublicCode) {
    void router.push({
      name: PublicRoutes.StoreProductByCode,
      params: { storeSlug, code: normalizedPublicCode },
    })
    return
  }

  toast.info('Nao foi possivel abrir os detalhes deste produto no momento.')
}

function canOpenWhatsAppCheckout(): boolean {
  if (items.value.length === 0) {
    toast.info('Adicione produtos ao pedido antes de finalizar pelo WhatsApp.')
    return false
  }

  if (!isWhatsAppConfigured.value) {
    toast.info('WhatsApp da loja ainda nao configurado.')
    return false
  }

  return true
}

async function handleSubmitOrder(): Promise<void> {
  if (!canOpenWhatsAppCheckout() || isSubmittingOrder.value) {
    return
  }

  isSubmittingOrder.value = true

  try {
    const checkout = await orderService.checkoutViaWhatsApp(items.value, customer.value)

    if (!checkout.whatsapp_url) {
      toast.error('Nao foi possivel abrir o WhatsApp da loja. Seu carrinho foi mantido.')
      return
    }

    const openedWindow = window.open(checkout.whatsapp_url, '_blank', 'noopener,noreferrer')
    if (!openedWindow) {
      window.location.href = checkout.whatsapp_url
    }
    toast.success(`Pedido ${checkout.order_reference} registrado. Abrimos o WhatsApp para atendimento.`)

    clearCart()
    resetCustomer()
    isCartOpen.value = false
    await fetchProducts()
  } catch (checkoutError) {
    Logger.warn('Failed to register WhatsApp checkout', {
      error: checkoutError instanceof Error ? checkoutError.message : 'unknown_error',
    })
    const correlationId = getErrorRequestId(checkoutError)
    toast.error(extractCheckoutErrorMessage(checkoutError), undefined, {
      label: 'Relatar problema',
      onClick: () =>
        openFeedback({
          type: 'checkout',
          pagePath: route.fullPath,
          correlationId,
        }),
    })
  } finally {
    isSubmittingOrder.value = false
  }
}
</script>
