<script setup lang="ts">
/**
 * Storefront brand lockup: logo + store name, optionally linking home.
 *
 * Single owner of the logo <img> (alt, fallback, sizing) and the name
 * truncation rule, so the catalog and detail headers can't drift.
 */
import { ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

withDefaults(
  defineProps<{
    name: string
    logoUrl?: string | null
    to?: RouteLocationRaw | null
    /** Logo edge length in px (32-40 range for headers). */
    size?: number
    /** Hide the name, keep it for assistive tech (very tight layouts). */
    hideName?: boolean
  }>(),
  {
    size: 34,
    hideName: false,
  },
)

const logoFailed = ref(false)
function onLogoError(): void {
  logoFailed.value = true
}
</script>

<template>
  <component
    :is="to ? 'RouterLink' : 'div'"
    :to="to || undefined"
    class="storefront-brand group inline-flex min-w-0 items-center gap-2.5"
    :aria-label="to ? `${name} — ir para o catálogo` : undefined"
  >
    <span
      class="flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--store-radius-sm)] bg-[var(--store-surface)]"
      :style="{ height: `${size}px`, width: `${size}px` }"
    >
      <img
        v-if="logoUrl && !logoFailed"
        :src="logoUrl"
        :alt="name"
        class="h-full w-full object-contain"
        decoding="async"
        @error="onLogoError"
      />
      <span
        v-else
        class="flex h-full w-full items-center justify-center text-[0.8em] font-semibold uppercase text-[var(--store-brand-on-light)]"
        aria-hidden="true"
      >
        {{ name.trim().slice(0, 2).toUpperCase() }}
      </span>
    </span>

    <span
      class="min-w-0 truncate text-[0.975rem] font-semibold leading-tight text-[var(--store-text)] sm:text-base"
      :class="{ 'sr-only': hideName }"
    >
      {{ name }}
    </span>
  </component>
</template>
