import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useMediaQuery } from './useMediaQuery'

export interface UseCarouselAutoplayOptions {
  /** Number of slides. Autoplay and navigation are inert when this is <= 1. */
  slideCount: Ref<number> | ComputedRef<number>
  /** Autoplay interval in ms. */
  intervalMs: number
}

export interface UseCarouselAutoplayReturn {
  activeIndex: Readonly<Ref<number>>
  /** True once mounted with 2+ slides and motion is not reduced. */
  isAutoplaying: ComputedRef<boolean>
  goTo: (index: number) => void
  next: () => void
  previous: () => void
  /** Stop the timer (hover/focus/touch) without losing the current slide. */
  pause: () => void
  /** Restart the timer from a fresh interval, e.g. after a manual navigation
   * or once a pause ends. */
  resume: () => void
}

/**
 * Single timer primitive shared by the hero and promotions carousels so
 * autoplay start/stop/cleanup is implemented exactly once: one `setInterval`
 * per instance, always cleared on scope dispose, never started at all when
 * `prefers-reduced-motion` is set or there's only one (or zero) slides.
 */
export function useCarouselAutoplay(options: UseCarouselAutoplayOptions): UseCarouselAutoplayReturn {
  const { slideCount, intervalMs } = options
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const activeIndex = ref(0)
  const isPaused = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  const isAutoplaying = computed(
    () => slideCount.value > 1 && !prefersReducedMotion.value && !isPaused.value,
  )

  function clampIndex(index: number): number {
    const count = slideCount.value
    if (count <= 0) return 0
    return ((index % count) + count) % count
  }

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function startTimer(): void {
    stopTimer()
    if (!isAutoplaying.value) return
    timer = setInterval(() => {
      activeIndex.value = clampIndex(activeIndex.value + 1)
    }, intervalMs)
  }

  function goTo(index: number): void {
    activeIndex.value = clampIndex(index)
  }

  function next(): void {
    goTo(activeIndex.value + 1)
  }

  function previous(): void {
    goTo(activeIndex.value - 1)
  }

  // pause()/resume() start and stop the timer synchronously themselves
  // rather than only flipping `isPaused` and waiting for the watcher below:
  // Vue batches a plain `watch()` callback onto the next microtask, and a
  // caller pausing on `mouseenter` and resuming on `mouseleave` within the
  // same tick (or a test driving fake timers without awaiting one) must not
  // see the old interval fire in between.
  function pause(): void {
    isPaused.value = true
    stopTimer()
  }

  function resume(): void {
    isPaused.value = false
    startTimer()
  }

  watch(
    () => [slideCount.value, prefersReducedMotion.value] as const,
    () => {
      activeIndex.value = clampIndex(activeIndex.value)
      if (!isPaused.value) {
        startTimer()
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stopTimer()
  })

  return {
    activeIndex,
    isAutoplaying,
    goTo,
    next,
    previous,
    pause,
    resume,
  }
}
