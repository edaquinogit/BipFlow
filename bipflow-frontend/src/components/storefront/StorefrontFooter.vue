<script setup lang="ts">
/**
 * Shared storefront footer — one construction for the catalog and the product
 * detail page. Shows only what the store has actually provided (name, tagline,
 * city/UF, public links); never fabricates trust badges or promo copy.
 */
import { computed } from 'vue'
import type { PublicMerchantProfile } from '@/types/store'
import StorefrontSocialLinks from '@/views/products/StorefrontSocialLinks.vue'

const props = defineProps<{
  storeName: string
  tagline?: string | null
  merchant?: PublicMerchantProfile | null
}>()

const location = computed(() => {
  const city = props.merchant?.city?.trim() ?? ''
  const state = props.merchant?.state?.trim() ?? ''
  return [city, state].filter(Boolean).join(', ')
})
</script>

<template>
  <footer class="mt-12 border-t border-[var(--store-border)] py-8 text-center">
    <p class="text-sm font-semibold text-[var(--store-text)]">{{ storeName }}</p>
    <p v-if="tagline" class="mx-auto mt-1 max-w-md text-[0.8125rem] text-[var(--store-text-muted)]">
      {{ tagline }}
    </p>
    <p v-if="location" class="mt-1 text-[0.75rem] text-[var(--store-text-muted)]">{{ location }}</p>

    <div class="mt-4">
      <StorefrontSocialLinks :merchant="merchant" />
    </div>

    <div class="mt-4">
      <slot name="feedback" />
    </div>
  </footer>
</template>
