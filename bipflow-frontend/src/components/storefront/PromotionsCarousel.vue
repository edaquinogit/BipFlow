<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useCarouselAutoplay } from '@/composables/useCarouselAutoplay'
import { handleProductImageError } from '@/utils/productImagePlaceholder'
import type { PublicStorefrontBanner } from '@/types/store'

/**
 * Promotions rail (Ciclo 9): one horizontal, native-scroll carousel --
 * never a vertical grid, never a second row. One card per view on mobile
 * and tablet, up to two on desktop (CSS width only, not a paginated jump).
 * No side arrow buttons -- manual navigation is native swipe/drag-scroll,
 * the dots, or the left/right arrow keys once the track has focus. Autoplay
 * and all of those drive the same scroll position programmatically through
 * one shared timer (useCarouselAutoplay), so there is only one interval for
 * this component.
 */
const props = defineProps<{
  promotions: PublicStorefrontBanner[]
}>()

const slideCount = computed(() => props.promotions.length)
const { activeIndex, isAutoplaying, goTo, next, previous, pause, resume } = useCarouselAutoplay({
  slideCount,
  intervalMs: 5000,
})

const hasControls = computed(() => props.promotions.length > 1)
const trackRef = ref<HTMLElement | null>(null)
const itemRefs = ref<HTMLElement[]>([])
let suppressScrollSync = false

function setItemRef(el: Element | null, index: number): void {
  if (el instanceof HTMLElement) {
    itemRefs.value[index] = el
  }
}

// Scroll-jump regression (Ciclo 9): `target.scrollIntoView({ block: 'nearest' })`
// looked horizontal-only (`inline: 'start'`) but is not -- when the carousel
// sits above a scroll position the shopper has moved past (exactly what
// happens a few seconds into a real visit, once autoplay ticks), the browser
// also scrolls the *page* vertically to satisfy the block axis, because the
// target card is outside the viewport on that axis too. Compute the track's
// own `scrollLeft` directly instead, exactly like CategoryNav's chip
// centering -- this can only ever move the track, never the window.
async function scrollToActiveIndex(): Promise<void> {
  await nextTick()
  const track = trackRef.value
  const target = itemRefs.value[activeIndex.value]
  if (!track || !target || typeof track.scrollTo !== 'function') return

  suppressScrollSync = true
  track.scrollTo({ left: target.offsetLeft, behavior: 'smooth' })
  // scrollIntoView's smooth animation has no completion callback -- release
  // the sync guard after a duration comfortably longer than the animation
  // so a user-initiated swipe right after isn't ignored.
  window.setTimeout(() => {
    suppressScrollSync = false
  }, 500)
}

watch(activeIndex, () => {
  void scrollToActiveIndex()
})

function handleTrackScroll(): void {
  if (suppressScrollSync) return

  const track = trackRef.value
  if (!track) return

  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY
  itemRefs.value.forEach((item, index) => {
    const distance = Math.abs(item.offsetLeft - track.scrollLeft)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })
  goTo(closestIndex)
}
</script>

<template>
  <section
    v-if="promotions.length"
    data-cy="storefront-promotional-banners"
    class="relative mb-5 min-[390px]:mb-6"
    @mouseenter="pause"
    @mouseleave="resume"
    @focusin="pause"
    @focusout="resume"
    @touchstart="pause"
    @touchend="resume"
  >
    <div
      ref="trackRef"
      class="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-focus)]"
      role="region"
      :aria-roledescription="hasControls ? 'carrossel' : undefined"
      aria-label="Promocoes"
      :tabindex="hasControls ? 0 : undefined"
      @scroll="handleTrackScroll"
      @keydown.left="previous"
      @keydown.right="next"
    >
      <div
        v-for="(promotion, index) in promotions"
        :key="`${promotion.position}-${promotion.image_url}`"
        :ref="(el) => setItemRef(el as Element | null, index)"
        class="w-[calc(100%-1.5rem)] shrink-0 snap-start sm:w-[calc(100%-2rem)] lg:w-[calc(50%-0.375rem)]"
      >
        <component
          :is="promotion.button_url ? 'a' : 'div'"
          :href="promotion.button_url || undefined"
          class="group block overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-surface)] transition hover:border-[var(--store-brand-on-light)]"
        >
          <img
            :src="promotion.image_url"
            :alt="promotion.alt_text || promotion.title || ''"
            class="aspect-[5/2] w-full object-cover"
            loading="lazy"
            @error="handleProductImageError"
          />
          <div
            v-if="promotion.title || promotion.subtitle || (promotion.cta_text && promotion.button_url)"
            class="flex flex-col gap-3 border-t border-[var(--store-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <h3 v-if="promotion.title" class="text-sm font-semibold leading-tight text-[var(--store-text)]">
                {{ promotion.title }}
              </h3>
              <p v-if="promotion.subtitle" class="mt-1 text-xs leading-5 text-[var(--store-text-muted)]">
                {{ promotion.subtitle }}
              </p>
            </div>
            <span
              v-if="promotion.cta_text && promotion.button_url"
              class="storefront-primary-button inline-flex h-9 shrink-0 items-center justify-center rounded-[var(--store-radius-md)] px-3 text-[0.75rem] font-semibold uppercase tracking-wide"
            >
              {{ promotion.cta_text }}
            </span>
          </div>
        </component>
      </div>
    </div>

    <template v-if="hasControls">
      <div class="mt-3 flex items-center justify-center gap-2" role="tablist" aria-label="Posicao da promocao">
        <button
          v-for="(promotion, index) in promotions"
          :key="`dot-${promotion.position}-${promotion.image_url}`"
          type="button"
          role="tab"
          :aria-selected="index === activeIndex"
          :aria-label="`Ir para a promocao ${index + 1} de ${promotions.length}`"
          class="flex min-h-11 min-w-11 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-focus)]"
          @click="goTo(index)"
        >
          <span
            class="block h-2 w-2 rounded-full transition-colors"
            :class="index === activeIndex ? 'bg-[var(--store-brand-on-light)]' : 'bg-[var(--store-border)]'"
          />
        </button>
      </div>

      <span v-if="isAutoplaying" class="sr-only">Carrossel de promocoes avancando automaticamente.</span>
    </template>
  </section>
</template>

<style scoped>
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
