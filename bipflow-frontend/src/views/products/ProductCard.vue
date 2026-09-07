<template>
  <article
    class="storefront-product-card group relative flex h-full min-w-0 flex-col overflow-hidden border border-[var(--store-border)] bg-[var(--store-surface)]"
    :class="{ 'opacity-70': !canOrderProduct }"
  >
    <!-- Whole card opens the product; the CTA below sits above it and stops
         propagation so an "add" tap never navigates. -->
    <button
      type="button"
      class="absolute inset-0 z-10 h-full w-full"
      :aria-label="`Ver ${product.name}`"
      @click="handleOpenDetails"
    />

    <div class="relative aspect-[4/5] overflow-hidden bg-[var(--store-image-bg,#f3f4f6)]">
      <img
        :src="imageSource"
        :alt="`Imagem do produto ${product.name}`"
        class="h-full w-full transition-transform duration-200 group-hover:scale-[1.02]"
        :class="hasProductImage ? 'object-cover' : 'object-contain p-5'"
        loading="lazy"
        decoding="async"
        @error="handleImageError"
      />

      <div
        v-if="!canOrderProduct"
        class="absolute inset-0 flex items-center justify-center bg-[var(--store-text)]/45"
      >
        <span
          class="rounded-[var(--store-radius-sm)] bg-[var(--store-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--store-text)]"
        >
          Esgotado
        </span>
      </div>
    </div>

    <div class="flex flex-1 flex-col p-3 sm:p-3.5">
      <p
        v-if="product.category?.name"
        class="truncate text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--store-text-muted)]"
      >
        {{ product.category.name }}
      </p>

      <h3
        class="mt-1 line-clamp-2 text-[0.8125rem] font-medium leading-snug text-[var(--store-text)] sm:text-sm"
      >
        {{ product.name }}
      </h3>

      <p class="mt-1.5 text-[0.95rem] font-semibold text-[var(--store-text)] sm:text-base">
        <span v-if="displayedPrice.from" class="text-[0.72em] font-medium text-[var(--store-text-muted)]">A partir de </span>{{ formatBRL(displayedPrice.amount) }}
      </p>

      <div class="mt-1.5 flex min-h-4 items-center justify-between gap-2">
        <div
          v-if="activeVariants.length > 0"
          class="flex items-center gap-1"
          :aria-label="`${activeVariants.length} cores`"
        >
          <span
            v-for="variant in activeVariants.slice(0, 4)"
            :key="variant.id"
            class="h-2.5 w-2.5 shrink-0 overflow-hidden rounded-full border border-black/10"
            :style="variantSwatchImage(variant) ? undefined : { backgroundColor: variant.color_hex }"
            :title="variant.name"
          >
            <img
              v-if="variantSwatchImage(variant)"
              :src="variantSwatchImage(variant)!"
              alt=""
              class="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              @error="handleVariantSwatchImageError(variant)"
            />
          </span>
          <span v-if="activeVariants.length > 4" class="text-[0.625rem] text-[var(--store-text-muted)]">
            +{{ activeVariants.length - 4 }}
          </span>
        </div>
        <p
          v-if="availabilityNote || cartQuantity > 0"
          class="truncate text-[0.6875rem] text-[var(--store-text-muted)]"
        >
          <span v-if="cartQuantity > 0" class="font-semibold text-[var(--store-brand-on-light)]">{{ cartQuantity }} no pedido</span>
          <span v-else>{{ availabilityNote }}</span>
        </p>
      </div>

      <div class="relative z-20 mt-auto pt-2.5">
        <StorefrontButton
          data-cy="add-to-cart-button"
          variant="outline"
          block
          :disabled="!canOrderProduct"
          @click.stop="handleAddToCart"
        >
          <ShoppingBagIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ ctaLabel }}</span>
        </StorefrontButton>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ShoppingBagIcon } from '@heroicons/vue/24/outline'
import StorefrontButton from '@/components/storefront/StorefrontButton.vue'
import type { Product, ProductVariant } from '@/types/product'
import { formatBRL } from '@/utils/formatters'
import { displayPrice } from '@/utils/pricing'
import { handleProductImageError, resolveProductImage } from '@/utils/productImagePlaceholder'
import { isLowStock } from '@/utils/stockAlerts'

const props = withDefaults(
  defineProps<{
    product: Product
    cartQuantity?: number
  }>(),
  {
    cartQuantity: 0,
  },
)

const emit = defineEmits<{
  addToCart: [product: Product, quantity: number, variant?: ProductVariant | null]
  openDetails: [product: Product]
}>()

const activeVariants = computed(() =>
  [...(props.product.variants ?? [])]
    .filter((variant) => variant.is_active)
    .sort((left, right) => left.position - right.position || left.id - right.id),
)

// "A partir de R$ X" when active variants disagree on price; a single number
// otherwise. Backend recomputes the real price at checkout.
const displayedPrice = computed(() => displayPrice(props.product))

const hasActiveVariants = computed(() => activeVariants.value.length > 0)

function variantAvailableStock(variant: ProductVariant): number {
  const variantStock = Math.max(0, Math.trunc(Number(variant.stock_quantity) || 0))
  return Math.min(props.product.stock_quantity, variantStock)
}

const orderableVariants = computed(() =>
  activeVariants.value.filter((variant) => variantAvailableStock(variant) > 0),
)

const defaultVariant = computed(
  () => orderableVariants.value[0] ?? activeVariants.value[0] ?? null,
)

const currentAvailableStock = computed(() => {
  if (!props.product.is_available) {
    return 0
  }
  if (!hasActiveVariants.value) {
    return props.product.stock_quantity
  }
  return defaultVariant.value ? variantAvailableStock(defaultVariant.value) : 0
})

const canOrderProduct = computed(() => currentAvailableStock.value > 0)

const imageSource = computed(() =>
  resolveProductImage(defaultVariant.value?.image, props.product.image),
)
const hasProductImage = computed(() =>
  Boolean(defaultVariant.value?.image || props.product.image),
)

// Availability is secondary information: only surfaced when it changes the
// buying decision (out, or running low), never a permanent "Disponível" tag.
const availabilityNote = computed(() => {
  if (!canOrderProduct.value) {
    return 'Indisponível'
  }
  if (hasActiveVariants.value && defaultVariant.value && currentAvailableStock.value <= 5) {
    return `${currentAvailableStock.value} nesta cor`
  }
  if (!hasActiveVariants.value && isLowStock(props.product)) {
    return `${props.product.stock_quantity} restantes`
  }
  return ''
})

const ctaLabel = computed(() => (canOrderProduct.value ? 'Adicionar' : 'Indisponível'))

const handleImageError = handleProductImageError

// Ciclo 9: the color dots must show the variant's own image when one was
// uploaded, and fall back to the color chip otherwise -- never paint over a
// valid image with a solid color. `brokenVariantImageIds` keeps a 404'd
// upload falling back to the color chip without retrying it in a loop.
const brokenVariantImageIds = ref<Set<number>>(new Set())

function variantSwatchImage(variant: ProductVariant): string | null {
  if (!variant.image || brokenVariantImageIds.value.has(variant.id)) {
    return null
  }
  return variant.image
}

function handleVariantSwatchImageError(variant: ProductVariant): void {
  if (brokenVariantImageIds.value.has(variant.id)) {
    return
  }
  brokenVariantImageIds.value = new Set(brokenVariantImageIds.value).add(variant.id)
}

function handleAddToCart(): void {
  if (!canOrderProduct.value) {
    return
  }
  if (defaultVariant.value) {
    emit('addToCart', props.product, 1, defaultVariant.value)
  } else {
    emit('addToCart', props.product, 1)
  }
}

function handleOpenDetails(): void {
  emit('openDetails', props.product)
}
</script>
