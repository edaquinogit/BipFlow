<script setup lang="ts">
/**
 * Unified storefront header shell — one construction for the catalog and the
 * product detail page. Mobile-first:
 *
 *   mobile  ─ row 1: brand ............... account · cart
 *           ─ row 2 (catalog only): search · filters
 *   desktop ─ single row: brand ─ search (centred, bounded) ─ account · cart
 *
 * Owns the search field and the cart affordance so the two views can't drift.
 * Filtering / cart / navigation behaviour stays in the parent via events.
 */
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { MagnifyingGlassIcon, ShoppingBagIcon } from '@heroicons/vue/24/outline'
import StorefrontBrand from './StorefrontBrand.vue'
import StorefrontField from './StorefrontField.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { formatBRL } from '@/utils/formatters'

const props = withDefaults(
  defineProps<{
    variant?: 'catalog' | 'detail'
    storeName: string
    logoUrl?: string | null
    catalogTo?: RouteLocationRaw | null
    search?: string
    itemCount?: number
    subtotal?: number
    filtersOpen?: boolean
    activeFilterCount?: number
  }>(),
  {
    variant: 'catalog',
    search: '',
    itemCount: 0,
    subtotal: 0,
    filtersOpen: false,
    activeFilterCount: 0,
  },
)

const emit = defineEmits<{
  'update:search': [value: string]
  'open-cart': []
  'toggle-filters': []
}>()

const isDesktop = useMediaQuery('(min-width: 1024px)')
const showSearch = computed(() => props.variant === 'catalog')
const cartLabel = computed(() => {
  const noun = props.itemCount === 1 ? 'item' : 'itens'
  return props.itemCount > 0
    ? `Abrir pedido — ${props.itemCount} ${noun}, ${formatBRL(props.subtotal)}`
    : 'Abrir pedido'
})
const badgeCount = computed(() => (props.itemCount > 99 ? '99+' : String(props.itemCount)))
</script>

<template>
  <header class="storefront-header sticky top-0 z-30 border-b">
    <div
      class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 lg:px-8"
    >
      <StorefrontBrand
        :name="storeName"
        :logo-url="logoUrl"
        :to="catalogTo"
        :size="34"
        class="min-w-0"
        :class="isDesktop ? 'max-w-[34%]' : 'flex-1'"
      />

      <!-- Desktop: centred, width-bounded search -->
      <div v-if="isDesktop && showSearch" class="mx-auto flex w-full max-w-md items-center gap-2">
        <StorefrontField
          class="min-w-0 flex-1"
          label="Buscar produtos"
          hide-label
          aria-label="Buscar produtos por nome"
          type="search"
          inputmode="search"
          placeholder="Buscar produto"
          :model-value="search"
          @update:model-value="emit('update:search', $event)"
        >
          <template #icon>
            <MagnifyingGlassIcon class="h-5 w-5" aria-hidden="true" />
          </template>
        </StorefrontField>
        <button
          type="button"
          :aria-expanded="filtersOpen"
          aria-label="Abrir filtros"
          class="storefront-icon-btn relative"
          @click="emit('toggle-filters')"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span
            v-if="activeFilterCount > 0"
            class="storefront-header__badge"
            aria-hidden="true"
          >{{ activeFilterCount }}</span>
        </button>
      </div>
      <div v-else-if="isDesktop" class="flex-1" />

      <!-- Actions -->
      <div class="flex shrink-0 items-center gap-2">
        <slot name="account" />

        <!-- Mobile: subtle nav affordance (the floating "Ver pedido" is the
             action CTA). Desktop: the header cart IS the CTA. -->
        <button
          type="button"
          data-cy="open-cart-button"
          :aria-label="cartLabel"
          class="storefront-header__cart"
          :class="itemCount > 0 ? 'storefront-header__cart--active' : ''"
          @click="emit('open-cart')"
        >
          <span class="relative inline-flex">
            <ShoppingBagIcon class="h-5 w-5" aria-hidden="true" />
            <span
              v-if="itemCount > 0"
              class="storefront-header__badge"
              aria-hidden="true"
            >{{ badgeCount }}</span>
          </span>
          <span class="hidden lg:inline">Pedido</span>
          <span v-if="itemCount > 0" class="hidden font-semibold lg:inline">{{ formatBRL(subtotal) }}</span>
        </button>
      </div>
    </div>

    <!-- Mobile search row (catalog only) -->
    <div
      v-if="!isDesktop && showSearch"
      class="border-t border-[var(--store-border)]"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:px-6">
        <StorefrontField
          class="min-w-0 flex-1"
          label="Buscar produtos"
          hide-label
          aria-label="Buscar produtos por nome"
          type="search"
          inputmode="search"
          placeholder="Buscar produto"
          :model-value="search"
          @update:model-value="emit('update:search', $event)"
        >
          <template #icon>
            <MagnifyingGlassIcon class="h-5 w-5" aria-hidden="true" />
          </template>
        </StorefrontField>
        <button
          type="button"
          :aria-expanded="filtersOpen"
          aria-label="Abrir filtros"
          class="storefront-icon-btn relative"
          @click="emit('toggle-filters')"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span v-if="activeFilterCount > 0" class="storefront-header__badge" aria-hidden="true">
            {{ activeFilterCount }}
          </span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.storefront-header {
  background: var(--store-surface);
  border-color: var(--store-border);
}

.storefront-header__cart {
  display: inline-flex;
  height: 2.75rem;
  min-width: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: var(--store-radius-md, 0.75rem);
  border: 1px solid var(--store-border);
  background: var(--store-surface);
  color: var(--store-text);
  padding-inline: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  transition: color var(--motion-base, 160ms), background-color var(--motion-base, 160ms),
    border-color var(--motion-base, 160ms);
}

.storefront-header__cart:hover {
  border-color: var(--store-brand-on-light);
  color: var(--store-brand-on-light);
}

/* On desktop the header cart is the primary order CTA (no floating button
   there); on mobile it stays a quiet nav affordance. */
@media (min-width: 1024px) {
  .storefront-header__cart {
    padding-inline: 1rem;
  }
  .storefront-header__cart--active {
    border-color: var(--store-brand);
    background: var(--store-brand);
    color: var(--store-brand-contrast);
  }
  .storefront-header__cart--active:hover {
    border-color: var(--store-brand-strong);
    background: var(--store-brand-strong);
    color: var(--store-brand-contrast);
  }
}

.storefront-header__badge {
  position: absolute;
  top: -0.3rem;
  right: -0.35rem;
  display: inline-flex;
  min-width: 1rem;
  height: 1rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  padding-inline: 0.2rem;
  border: 1.5px solid var(--store-surface);
  background: var(--store-brand-on-light);
  color: var(--store-surface);
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
}

@media (min-width: 1024px) {
  .storefront-header__cart--active .storefront-header__badge {
    border-color: var(--store-brand);
    background: var(--store-brand-contrast);
    color: var(--store-brand);
  }
}
</style>
