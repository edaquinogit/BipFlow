<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import type { Category } from '@/schemas/category.schema'

/**
 * Always-visible category picker (Ciclo 9) between the discovery sections
 * and the catalog grid -- the equivalent chips already existed, but only
 * inside the filters sheet. Reuses the exact same `.storefront-chip` /
 * `.storefront-chip--on` tokens (and their contrast fix) and the same
 * `categoryId` filter state the sheet writes to, so there is only one
 * category-filtering mechanism, just two entry points into it.
 */
const props = defineProps<{
  categories: Category[]
  activeCategoryId: number | undefined
}>()

const emit = defineEmits<{
  select: [categoryId: number | undefined]
}>()

// Scroll-jump regression fix (Ciclo 9): centering the active chip must only
// ever move this row's own `scrollLeft`, never `window.scrollY` -- so this
// scrolls the track element directly instead of `chip.scrollIntoView()`,
// which (even with `{ block: 'nearest' }`) can still scroll an ancestor
// vertically to bring the row itself into view.
const trackRef = ref<HTMLElement | null>(null)
const chipRefs = ref<Record<string, HTMLElement>>({})
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

function setChipRef(el: Element | null, key: string): void {
  if (el instanceof HTMLElement) {
    chipRefs.value[key] = el
  }
}

function centerActiveChipHorizontally(): void {
  const track = trackRef.value
  const chipKey = props.activeCategoryId ? String(props.activeCategoryId) : 'all'
  const chip = chipRefs.value[chipKey]
  if (!track || !chip || typeof track.scrollTo !== 'function') return

  const target = Math.max(
    0,
    Math.min(
      chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2,
      track.scrollWidth - track.clientWidth,
    ),
  )

  track.scrollTo({ left: target, behavior: prefersReducedMotion.value ? 'auto' : 'smooth' })
}

watch(
  () => props.activeCategoryId,
  () => {
    void nextTick(centerActiveChipHorizontally)
  },
)
</script>

<template>
  <nav
    v-if="categories.length"
    data-cy="storefront-category-nav"
    aria-label="Categorias"
    class="mb-5 sm:mb-6"
  >
    <h2 class="sr-only">Categorias</h2>
    <div
      ref="trackRef"
      class="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <button
        :ref="(el) => setChipRef(el as Element | null, 'all')"
        type="button"
        data-cy="storefront-category-chip-all"
        class="storefront-chip shrink-0 snap-start"
        :class="{ 'storefront-chip--on': !activeCategoryId }"
        :aria-pressed="!activeCategoryId"
        @click="emit('select', undefined)"
      >
        Todos
      </button>
      <button
        v-for="category in categories"
        :key="category.id"
        :ref="(el) => setChipRef(el as Element | null, String(category.id))"
        type="button"
        data-cy="storefront-category-chip"
        class="storefront-chip shrink-0 snap-start"
        :class="{ 'storefront-chip--on': activeCategoryId === category.id }"
        :aria-pressed="activeCategoryId === category.id"
        @click="emit('select', category.id)"
      >
        {{ category.name }}
      </button>
    </div>
  </nav>
</template>

<style scoped>
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
