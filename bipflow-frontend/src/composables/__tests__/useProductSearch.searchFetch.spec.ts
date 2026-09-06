import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useProductSearch, type UseProductSearchReturn } from '../useProductSearch'
import productService from '@/services/product.service'
import { setSelectedStoreSlug } from '@/services/store-scope'
import type { PaginatedProductsResponse, ProductFilters } from '@/types/product'

vi.mock('@/services/product.service', () => ({
  default: { list: vi.fn() },
}))

function response(overrides: Partial<PaginatedProductsResponse> = {}): PaginatedProductsResponse {
  return {
    count: 1,
    next: null,
    previous: null,
    page_size: 12,
    total_pages: 1,
    results: [{ id: 1, name: 'Match' } as never],
    ...overrides,
  }
}

/**
 * `useProductSearch` uses lifecycle hooks (`onBeforeUnmount`), so it must be
 * exercised from inside a real component instance, not called bare.
 */
function withSearch(debounceDelay = 40) {
  const holder: { api: UseProductSearchReturn | null } = { api: null }
  const wrapper = mount(
    defineComponent({
      setup() {
        holder.api = useProductSearch({ pageSize: 12, debounceDelay })
        return () => h('div')
      },
    }),
  )
  if (!holder.api) throw new Error('useProductSearch did not initialise')
  return { api: holder.api, wrapper }
}

function listFilterCalls(): Array<Partial<ProductFilters>> {
  return vi.mocked(productService.list).mock.calls.map((call) => call[0] as Partial<ProductFilters>)
}

function lastListFilters(): Partial<ProductFilters> {
  const calls = listFilterCalls()
  const last = calls.at(-1)
  if (!last) throw new Error('productService.list was never called')
  return last
}

describe('useProductSearch — free-text search reaches the backend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSelectedStoreSlug(null)
    window.localStorage.clear()
    vi.mocked(productService.list).mockResolvedValue(response())
  })

  it('issues a productService.list call carrying the typed term (regression: it never did)', async () => {
    const { api, wrapper } = withSearch()
    await flushPromises()
    vi.mocked(productService.list).mockClear()

    // One keystroke per character, exactly how StorefrontHeader drives it.
    for (const term of ['P', 'Pr', 'Produto Demo E2E']) {
      api.updateFilters({ search: term })
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()

    expect(listFilterCalls().length).toBeGreaterThan(0)
    expect(lastListFilters().search).toBe('Produto Demo E2E')

    wrapper.unmount()
  })

  it('collapses a burst of keystrokes into a single trailing request with the final value', async () => {
    const { api, wrapper } = withSearch()
    await flushPromises()
    vi.mocked(productService.list).mockClear()

    'camiseta'.split('').reduce((acc, char) => {
      const next = acc + char
      api.updateFilters({ search: next })
      return next
    }, '')

    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()

    expect(listFilterCalls()).toHaveLength(1)
    expect(lastListFilters().search).toBe('camiseta')

    wrapper.unmount()
  })

  it('clearing the term issues a request with no search filter', async () => {
    const { api, wrapper } = withSearch()
    await flushPromises()

    api.updateFilters({ search: 'shoes' })
    await new Promise((resolve) => setTimeout(resolve, 80))
    await flushPromises()
    vi.mocked(productService.list).mockClear()

    api.updateFilters({ search: '' })
    await new Promise((resolve) => setTimeout(resolve, 80))
    await flushPromises()

    expect(listFilterCalls().length).toBeGreaterThan(0)
    expect(lastListFilters().search).toBe('')

    wrapper.unmount()
  })

  it('a structured filter cancels a still-pending keystroke request so it cannot land late', async () => {
    const { api, wrapper } = withSearch(60)
    await flushPromises()
    vi.mocked(productService.list).mockClear()

    api.updateFilters({ search: 'sh' })
    // category applies immediately, before the 60ms search timer elapses
    api.updateFilters({ categoryId: 7 })

    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()

    // exactly one fetch (the category one); the superseded keystroke timer was
    // cancelled rather than firing a second, stale request afterwards
    expect(listFilterCalls()).toHaveLength(1)
    expect(lastListFilters().categoryId).toBe(7)
    expect(lastListFilters().search).toBe('sh')

    wrapper.unmount()
  })
})
