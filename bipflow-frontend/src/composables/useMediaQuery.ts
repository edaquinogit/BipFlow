import { onScopeDispose, readonly, ref, type Ref } from 'vue'

/**
 * Reactive `matchMedia` for layout decisions that CSS alone can't express
 * (rendering a control in one place vs another, hover-only affordances,
 * drawer vs popover). Defaults to `false` when `matchMedia` is unavailable
 * (SSR / jsdom without the shim) so callers stay mobile-first.
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const matches = ref(false)

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia(query)
    matches.value = mql.matches

    const onChange = (event: MediaQueryListEvent) => {
      matches.value = event.matches
    }

    mql.addEventListener('change', onChange)
    onScopeDispose(() => mql.removeEventListener('change', onChange))
  }

  return readonly(matches)
}
