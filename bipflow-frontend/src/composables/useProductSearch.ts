import { computed, nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import productService from '@/services/product.service'
import { Logger } from '@/services/logger'
import { getSelectedStoreSlug } from '@/services/store-scope'
import { getErrorRequestId } from '@/types/errors'
import type { PaginatedProductsResponse, Product, ProductFilters } from '@/types/product'

export interface UseProductSearchOptions {
  pageSize?: number
  debounceDelay?: number
  cacheDuration?: number
  initialFilters?: Partial<ProductFilters>
  initialPage?: number
}

export interface UseProductSearchReturn {
  products: Ref<Product[]>
  isLoading: Ref<boolean>
  isInitialLoading: Ref<boolean>
  error: Ref<string | null>
  /** X-Request-ID of the failed request, when `error` is set -- lets a
   * "Relatar problema" action attach the exact server log line. */
  errorCorrelationId: Ref<string>
  page: Ref<number>
  pageSize: Ref<number>
  totalCount: Ref<number>
  totalPages: Ref<number>
  filters: Ref<ProductFilters>
  hasNextPage: ComputedRef<boolean>
  hasPreviousPage: ComputedRef<boolean>
  isFirstPage: ComputedRef<boolean>
  isLastPage: ComputedRef<boolean>
  showingRange: ComputedRef<string>
  fetchProducts: () => Promise<void>
  updateFilters: (newFilters: Partial<ProductFilters>) => void
  clearFilters: () => void
  goToPage: (pageNumber: number) => void
  nextPage: () => void
  previousPage: () => void
  resetSearch: () => void
}

function normalizeFilters(filters: Partial<ProductFilters>): ProductFilters {
  return {
    search: typeof filters.search === 'string' ? filters.search : '',
    categoryId: filters.categoryId,
    priceMin: filters.priceMin,
    priceMax: filters.priceMax,
    inStockOnly: filters.inStockOnly ?? false,
  }
}

export const useProductSearch = (
  options: UseProductSearchOptions = {}
): UseProductSearchReturn => {
  const {
    pageSize: initialPageSize = 12,
    debounceDelay = 300,
    cacheDuration = 5 * 60 * 1000,
    initialFilters = {},
    initialPage = 1,
  } = options

  const products = ref<Product[]>([])
  const isLoading = ref(false)
  const isInitialLoading = ref(false)
  const error = ref<string | null>(null)
  const errorCorrelationId = ref('')
  const page = ref(Math.max(1, initialPage))
  const pageSize = ref(initialPageSize)
  const totalCount = ref(0)
  const totalPages = ref(0)
  const filters = ref<ProductFilters>(normalizeFilters(initialFilters))

  const cache = new Map<string, { data: PaginatedProductsResponse; timestamp: number }>()
  let lastIssuedRequest = 0

  const hasNextPage = computed(() => page.value < totalPages.value)
  const hasPreviousPage = computed(() => page.value > 1)
  const isFirstPage = computed(() => page.value === 1)
  const isLastPage = computed(() => page.value === totalPages.value)

  const showingRange = computed(() => {
    if (totalCount.value === 0) {
      return 'Nenhum produto encontrado'
    }

    const start = (page.value - 1) * pageSize.value + 1
    const end = Math.min(page.value * pageSize.value, totalCount.value)

    return `Exibindo ${start}-${end} de ${totalCount.value} produtos`
  })

  const getCacheKey = (): string =>
    JSON.stringify({
      storeSlug: getSelectedStoreSlug() || 'default',
      ...filters.value,
      page: page.value,
      pageSize: pageSize.value,
    })

  const isCacheValid = (timestamp: number): boolean =>
    Date.now() - timestamp < cacheDuration

  const updateStateFromResponse = (response: PaginatedProductsResponse): void => {
    products.value = response.results
    totalCount.value = response.count
    totalPages.value = response.total_pages
  }

  const fetchProductsInternal = async (): Promise<void> => {
    isLoading.value = true
    isInitialLoading.value = true
    error.value = null
    errorCorrelationId.value = ''

    const requestId = ++lastIssuedRequest
    const cacheKey = getCacheKey()
    const cached = cache.get(cacheKey)

    if (cached && isCacheValid(cached.timestamp)) {
      Logger.debug('Using cached public products response', {
        cacheKey,
        page: page.value,
      })
      updateStateFromResponse(cached.data)
      if (requestId === lastIssuedRequest) {
        isLoading.value = false
        isInitialLoading.value = false
      }
      return
    }

    try {
      const response = await productService.list(filters.value, page.value, pageSize.value)

      if (requestId !== lastIssuedRequest) {
        return
      }

      cache.set(cacheKey, {
        data: response,
        timestamp: Date.now(),
      })

      updateStateFromResponse(response)
      Logger.debug('Public products fetched successfully', {
        page: page.value,
        resultCount: response.results.length,
        totalCount: response.count,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Erro ao carregar produtos'
      errorCorrelationId.value = getErrorRequestId(err)
      Logger.error('Public product fetch failed', {
        page: page.value,
        error: error.value,
      })
    } finally {
      if (requestId === lastIssuedRequest) {
        isLoading.value = false
        isInitialLoading.value = false
      }
    }
  }

  // Trailing-edge debounce dedicated to the free-text search box. This used to
  // go through the shared `@/utils/debounce`, but that utility gates its
  // trailing edge on a non-empty argument list -- and `updateFilters` invokes
  // it with no arguments -- so every keystroke-driven search fetch was silently
  // dropped and the catalog request went out without `search` at all. A tiny
  // local timer with one responsibility removes that failure mode entirely.
  // `fetchProductsInternal` reads `filters.value` itself, so nothing needs to
  // be threaded through the closure.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const cancelPendingSearch = (): void => {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
  }

  const scheduleSearch = (): void => {
    cancelPendingSearch()
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      void fetchProductsInternal()
    }, debounceDelay)
  }

  const fetchProducts = async (): Promise<void> => {
    cancelPendingSearch()
    await fetchProductsInternal()
  }

  const updateFilters = (newFilters: Partial<ProductFilters>): void => {
    filters.value = normalizeFilters({
      ...filters.value,
      ...newFilters,
    })
    page.value = 1
    cache.clear()

    if ('search' in newFilters) {
      scheduleSearch()
      return
    }

    // A structured filter (category / stock / price) is a committed choice, not
    // mid-typing: fetch now and drop any keystroke fetch still pending so a
    // slower stale search response can't land on top of it.
    cancelPendingSearch()
    void fetchProductsInternal()
  }

  const clearFilters = (): void => {
    filters.value = normalizeFilters({})
    page.value = 1
    cache.clear()
    cancelPendingSearch()
    void fetchProductsInternal()
  }

  const goToPage = (pageNumber: number): void => {
    if (
      pageNumber < 1 ||
      pageNumber > totalPages.value ||
      pageNumber === page.value ||
      isLoading.value
    ) {
      return
    }

    page.value = pageNumber
    cancelPendingSearch()
    void fetchProductsInternal()
  }

  const nextPage = (): void => {
    if (!hasNextPage.value || isLoading.value) {
      return
    }

    page.value += 1
    cancelPendingSearch()
    void fetchProductsInternal()
  }

  const previousPage = (): void => {
    if (!hasPreviousPage.value || isLoading.value) {
      return
    }

    page.value -= 1
    cancelPendingSearch()
    void fetchProductsInternal()
  }

  const resetSearch = (): void => {
    cache.clear()
    clearFilters()
  }

  watch(pageSize, () => {
    page.value = 1
    cache.clear()
    cancelPendingSearch()
    void fetchProductsInternal()
  })

  onBeforeUnmount(() => {
    cancelPendingSearch()
  })

  nextTick(() => {
    void fetchProductsInternal()
  })

  return {
    products,
    isLoading,
    isInitialLoading,
    error,
    errorCorrelationId,
    page,
    pageSize,
    totalCount,
    totalPages,
    filters,
    hasNextPage,
    hasPreviousPage,
    isFirstPage,
    isLastPage,
    showingRange,
    fetchProducts,
    updateFilters,
    clearFilters,
    goToPage,
    nextPage,
    previousPage,
    resetSearch,
  }
}
