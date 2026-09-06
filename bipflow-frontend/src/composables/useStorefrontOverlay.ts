import { computed, onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

/**
 * Shared "a storefront overlay is open" signal. The cart drawer and the filter
 * sheet register while open; other UI (the toast host) reads it to get out of
 * the way instead of stacking on top of a modal's header.
 *
 * Also owns the body scroll lock so both overlays behave consistently.
 */
const openCount = ref(0)

export const isStorefrontOverlayOpen = readonly(computed(() => openCount.value > 0))

function acquire(): void {
  openCount.value += 1
  if (openCount.value === 1 && typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden'
  }
}

function release(): void {
  openCount.value = Math.max(0, openCount.value - 1)
  if (openCount.value === 0 && typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
}

/** Call from an overlay component, passing its `isOpen` ref. */
export function useStorefrontOverlay(isOpen: Ref<boolean>): void {
  let held = false

  watch(
    isOpen,
    (open) => {
      if (open && !held) {
        held = true
        acquire()
      } else if (!open && held) {
        held = false
        release()
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    if (held) {
      held = false
      release()
    }
  })
}
