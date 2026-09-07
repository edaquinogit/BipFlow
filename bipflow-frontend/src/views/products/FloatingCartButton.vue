<template>
  <Transition name="cart-fab">
    <button
      v-if="itemCount > 0"
      type="button"
      class="storefront-primary-button fixed bottom-[calc(0.875rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-12 items-center justify-center gap-2 rounded-[var(--store-radius-md)] px-4 text-sm font-semibold shadow-[var(--shadow-sf-overlay)] transition focus:outline-none sm:right-6 lg:hidden"
      :aria-label="cartAriaLabel"
      @click="$emit('openCart')"
    >
      <ShoppingCartIcon class="h-5 w-5" aria-hidden="true" />
      <span>Ver pedido</span>
      <span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--store-brand-contrast)] px-1 text-[0.6875rem] font-bold leading-none text-[var(--store-brand)]">
        {{ visibleItemCount }}
      </span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ShoppingCartIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  itemCount: number
}>()

defineEmits<{
  openCart: []
}>()

const cartAriaLabel = computed(() => {
  const itemLabel = props.itemCount === 1 ? 'item' : 'itens'

  return `Abrir carrinho com ${props.itemCount} ${itemLabel}`
})

const visibleItemCount = computed(() => (props.itemCount > 99 ? '99+' : String(props.itemCount)))
</script>

<style scoped>
.cart-fab-enter-active,
.cart-fab-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.cart-fab-enter-from,
.cart-fab-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.94);
}
</style>
