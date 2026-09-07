import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalized, RouteLocationNormalizedLoaded } from 'vue-router'
import { resolveScrollBehavior } from '../index'

function route(overrides: Partial<RouteLocationNormalized>): RouteLocationNormalized {
  return {
    path: '/l/default/produtos',
    hash: '',
    query: {},
    fullPath: '/l/default/produtos',
    ...overrides,
  } as RouteLocationNormalized
}

describe('resolveScrollBehavior (Ciclo 9 scroll-jump regression)', () => {
  it('preserves scroll when only the query changes on the same path (category/search/filter change)', () => {
    const from = route({ path: '/l/default/produtos', fullPath: '/l/default/produtos' })
    const to = route({
      path: '/l/default/produtos',
      fullPath: '/l/default/produtos?category=5',
      query: { category: '5' },
    })

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, null)

    // `false` tells Vue Router not to touch scroll at all -- this is the
    // exact assertion that fails against the pre-fix implementation, which
    // unconditionally returned `{ top: 0 }` here.
    expect(result).toBe(false)
  })

  it('still scrolls to top for a real navigation to a different page', () => {
    const from = route({ path: '/l/default/produtos', fullPath: '/l/default/produtos' })
    const to = route({ path: '/l/default/produtos/algum-produto', fullPath: '/l/default/produtos/algum-produto' })

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, null)

    expect(result).toEqual({ top: 0, behavior: 'smooth' })
  })

  it('still scrolls to top when switching to a different store, even though both paths end in /produtos', () => {
    const from = route({ path: '/l/loja-a/produtos', fullPath: '/l/loja-a/produtos' })
    const to = route({ path: '/l/loja-b/produtos', fullPath: '/l/loja-b/produtos' })

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, null)

    expect(result).toEqual({ top: 0, behavior: 'smooth' })
  })

  it('respects savedPosition (browser back/forward) over every other rule', () => {
    const from = route({ path: '/l/default/produtos' })
    const to = route({ path: '/l/default/produtos', hash: '#contato' })
    const savedPosition = { left: 0, top: 842 }

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, savedPosition)

    expect(result).toBe(savedPosition)
  })

  it('still scrolls to a hash target on a genuine cross-page anchor link', () => {
    const from = route({ path: '/l/default/produtos' })
    const to = route({ path: '/sobre', hash: '#contato' })

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, null)

    expect(result).toEqual({ el: '#contato', behavior: 'smooth' })
  })

  it('scrolls to top on the very first navigation into the products page', () => {
    // Vue Router's initial "from" is the special START_LOCATION, whose path
    // is "/" and therefore never equals a real products page path.
    const from = route({ path: '/' })
    const to = route({ path: '/l/default/produtos' })

    const result = resolveScrollBehavior(to, from as RouteLocationNormalizedLoaded, null)

    expect(result).toEqual({ top: 0, behavior: 'smooth' })
  })
})
