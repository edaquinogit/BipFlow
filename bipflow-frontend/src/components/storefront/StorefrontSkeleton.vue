<script setup lang="ts">
/**
 * Shared storefront loading placeholder (Ciclo 1).
 *
 * Presentational only: it carries `aria-hidden` so screen readers rely on the
 * surrounding container's `aria-busy` / live region instead of announcing
 * dozens of empty boxes. The pulse animates `opacity` only (no layout), and
 * prefers-reduced-motion (global, main.css) slows it to a near-static state.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'rect' | 'text' | 'circle'
    width?: string
    height?: string
    radius?: 'sm' | 'md' | 'lg' | 'full'
  }>(),
  {
    variant: 'rect',
    radius: 'md',
  },
)

const radiusVar = computed(() => {
  switch (props.radius) {
    case 'full':
      return '9999px'
    case 'lg':
      return 'var(--store-radius-lg, 1.25rem)'
    case 'sm':
      return 'var(--store-radius-sm, 0.5rem)'
    default:
      return 'var(--store-radius-md, 0.75rem)'
  }
})

const style = computed(() => ({
  width: props.width,
  height: props.height ?? (props.variant === 'text' ? '0.9em' : undefined),
  borderRadius: props.variant === 'circle' ? '9999px' : radiusVar.value,
}))
</script>

<template>
  <span class="storefront-skeleton block" :style="style" aria-hidden="true" />
</template>

<style scoped>
.storefront-skeleton {
  background: color-mix(in srgb, var(--store-text, #05050a) 9%, var(--store-surface, #ffffff));
  animation: storefront-skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes storefront-skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .storefront-skeleton {
    animation: none;
    opacity: 0.8;
  }
}
</style>
