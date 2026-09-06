<script setup lang="ts">
/**
 * Shared storefront button (Ciclo 1).
 *
 * - consumes the store theme tokens (--store-brand*, --store-focus, --motion-*)
 * - has normal / hover / focus-visible / active / disabled / loading states
 * - keeps a stable width while loading (the label stays in flow, the spinner
 *   overlays it) so a row never reflows on submit
 * - exposes aria-busy / aria-disabled and stays keyboard-operable
 * - motion is one token-driven transition, so prefers-reduced-motion
 *   (handled globally in main.css) neutralises it
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'outline' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    loadingLabel?: string
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
    loadingLabel: 'Carregando',
  },
)

const buttonRef = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => buttonRef.value?.focus() })

const isInert = computed(() => props.disabled || props.loading)

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'h-9 gap-1.5 px-3 text-[0.8125rem]'
    case 'lg':
      return 'h-12 gap-2 px-6 text-[0.9375rem]'
    default:
      return 'h-11 gap-2 px-4 text-sm'
  }
})

const variantClass = computed(() => `storefront-btn--${props.variant}`)
</script>

<template>
  <button
    ref="buttonRef"
    :type="type"
    :disabled="isInert"
    :aria-busy="loading ? 'true' : undefined"
    :aria-disabled="isInert ? 'true' : undefined"
    class="storefront-btn relative inline-flex select-none items-center justify-center border font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed"
    :class="[sizeClass, variantClass, block ? 'w-full' : '']"
  >
    <span
      class="inline-flex items-center gap-2"
      :class="{ invisible: loading }"
    >
      <slot />
    </span>

    <span
      v-if="loading"
      class="absolute inset-0 inline-flex items-center justify-center gap-2"
    >
      <span
        class="storefront-btn__spinner h-4 w-4 shrink-0 rounded-full border-2 border-current/30 border-t-current"
        aria-hidden="true"
      />
      <span class="sr-only">{{ loadingLabel }}</span>
    </span>
  </button>
</template>

<style scoped>
.storefront-btn {
  border-radius: var(--store-radius-md, var(--radius-sf-md, 0.75rem));
  transition-duration: var(--motion-base, 160ms);
  min-width: max-content;
}

.storefront-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.storefront-btn--primary {
  border-color: var(--store-brand, #05050a);
  background: var(--store-brand, #05050a);
  color: var(--store-brand-contrast, #ffffff);
}

.storefront-btn--primary:hover:not(:disabled) {
  border-color: var(--store-brand-strong, #000000);
  background: var(--store-brand-strong, #000000);
}

.storefront-btn--primary:disabled {
  border-color: #e5e7eb;
  background: #e5e7eb;
  color: #9ca3af;
}

.storefront-btn--outline {
  border-color: var(--store-border, #d1d5db);
  background: transparent;
  color: var(--store-text, #05050a);
}

.storefront-btn--outline:hover:not(:disabled) {
  border-color: var(--store-brand-on-light, #05050a);
  color: var(--store-brand-on-light, #05050a);
}

.storefront-btn--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--store-brand-on-light, #05050a);
}

.storefront-btn--ghost:hover:not(:disabled) {
  background: var(--store-brand-soft, #f3f4f6);
}

.storefront-btn--outline:disabled,
.storefront-btn--ghost:disabled {
  color: #9ca3af;
}

.storefront-btn__spinner {
  animation: storefront-btn-spin 0.7s linear infinite;
}

@keyframes storefront-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .storefront-btn__spinner {
    animation-duration: 1.4s;
  }
}
</style>
