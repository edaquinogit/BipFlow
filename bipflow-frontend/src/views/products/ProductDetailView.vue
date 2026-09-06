<template>
  <div
    class="storefront-shell min-h-screen"
    :data-card-style="storefrontAppearance?.card_style ?? 'clean'"
    :data-density="storefrontAppearance?.density ?? 'comfortable'"
    :data-font-preset="storefrontAppearance?.font_preset ?? 'modern'"
    :data-motion="storefrontAppearance?.motion_enabled === false ? 'off' : 'on'"
    :data-motion-intensity="storefrontAppearance?.motion_intensity ?? 'standard'"
    :data-decoration="storefrontAppearance?.decoration_enabled ? storefrontAppearance.decoration_style : 'none'"
    :style="storeBranding.cssVars"
  >
    <StorefrontHeader
      variant="detail"
      :store-name="storeBranding.name"
      :logo-url="storeBranding.logoUrl"
      :catalog-to="catalogRoute"
      :item-count="itemCount"
      :subtotal="subtotal"
      @open-cart="openCart"
    >
      <template #account>
        <CustomerProfileMenuButton />
      </template>
    </StorefrontHeader>

    <main class="mx-auto max-w-7xl px-4 py-4 pb-28 sm:px-6 lg:px-8 lg:py-8 lg:pb-16">
      <button
        type="button"
        class="storefront-back-link mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--store-text-muted)] transition-colors hover:text-[var(--store-brand-on-light)] lg:mb-4"
        @click="goBackToCatalog"
      >
        <ArrowLeftIcon class="h-4 w-4" aria-hidden="true" />
        Catálogo
      </button>

      <div v-if="isLoading" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-10">
        <StorefrontSkeleton radius="lg" class="aspect-[4/5] w-full" />

        <div class="space-y-3">
          <StorefrontSkeleton variant="text" width="35%" />
          <StorefrontSkeleton height="1.75rem" width="80%" />
          <StorefrontSkeleton height="1.75rem" width="45%" />
          <div class="flex gap-2 pt-2">
            <StorefrontSkeleton variant="circle" width="2.75rem" height="2.75rem" />
            <StorefrontSkeleton variant="circle" width="2.75rem" height="2.75rem" />
          </div>
          <StorefrontSkeleton height="5rem" class="!mt-6" />
        </div>
      </div>

      <div
        v-else-if="errorMessage || !product"
        class="mx-auto max-w-xl py-24 text-center"
      >
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm8.25-.75a8.25 8.25 0 10-16.5 0 8.25 8.25 0 0016.5 0z" />
          </svg>
        </div>
        <h2 class="mt-5 text-2xl font-semibold text-[var(--store-text)]">Nao foi possivel abrir este produto</h2>
        <p class="mt-3 text-base text-[var(--store-text-muted)]">
          {{ errorMessage || 'O produto pode ter sido removido ou esta temporariamente indisponivel.' }}
        </p>
        <div class="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <StorefrontButton @click="loadProduct">Tentar novamente</StorefrontButton>
          <StorefrontButton variant="outline" @click="goBackToCatalog">
            Voltar ao catalogo
          </StorefrontButton>
        </div>
      </div>

      <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-10">
        <section class="min-w-0 space-y-3">
          <div
            class="relative aspect-[4/5] w-full touch-pan-y overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-image-bg,#f3f4f6)]"
            @mouseenter="pauseCarousel"
            @mouseleave="resumeCarousel"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointercancel="handlePointerCancel"
            @pointerleave="handlePointerLeave"
          >
            <Transition :name="slideTransitionName" mode="out-in">
              <img
                :key="activeImageSource"
                :src="activeImageSource"
                :alt="`Imagem do produto ${product.name}`"
                class="h-full w-full select-none object-contain p-4 sm:p-8"
                loading="eager"
                decoding="async"
                draggable="false"
                @error="handleImageError"
              />
            </Transition>

            <div
              v-if="productImages.length > 1"
              class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-3"
            >
              <span
                v-for="(imageUrl, index) in productImages"
                :key="`${imageUrl}-${index}`"
                class="h-1.5 rounded-full transition-all"
                :class="imageUrl === activeImageSource ? 'w-6 bg-[var(--store-text)]' : 'w-1.5 bg-[var(--store-text)]/30'"
              />
            </div>
          </div>

          <div v-if="productImages.length > 1" class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="imageUrl in productImages"
              :key="imageUrl"
              type="button"
              class="aspect-square h-16 w-16 shrink-0 overflow-hidden rounded-[var(--store-radius-sm)] border bg-[var(--store-surface)] transition sm:h-20 sm:w-20"
              :class="imageUrl === activeImageSource
                ? 'border-[var(--store-brand-on-light)]'
                : 'border-[var(--store-border)] hover:border-[var(--store-brand-on-light)]'"
              :aria-label="`Ver imagem ${product.name}`"
              @click="handleSelectImage(imageUrl)"
            >
              <img
                :src="imageUrl"
                :alt="`Miniatura ${product.name}`"
                class="h-full w-full object-contain p-1.5"
                loading="lazy"
              />
            </button>
          </div>
        </section>

        <aside class="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <!-- 1. Context -->
          <div class="flex items-start justify-between gap-3">
            <p class="min-w-0 truncate text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
              {{ product.category.name }}
            </p>
            <button
              type="button"
              class="storefront-icon-btn -mr-1 -mt-1"
              :class="{ 'border-[var(--store-brand-on-light)] text-[var(--store-brand-on-light)]': isShareCopied }"
              :aria-label="isShareCopied ? 'Link do produto copiado' : 'Compartilhar produto'"
              @click="void handleShareProduct()"
            >
              <CheckIcon v-if="isShareCopied" class="h-4 w-4" aria-hidden="true" />
              <ShareIcon v-else class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <!-- 2. Product -->
          <h1 class="mt-1 text-2xl font-semibold leading-tight text-[var(--store-text)] sm:text-3xl">
            {{ product.name }}
          </h1>

          <!-- 3. Price -->
          <p class="mt-2 flex items-baseline gap-2 text-2xl font-semibold text-[var(--store-text)] sm:text-[1.75rem]">
            <span>
              <span v-if="headerPrice.from" class="text-base font-medium text-[var(--store-text-muted)]">A partir de </span>{{ formatBRL(headerPrice.amount) }}
            </span>
            <span
              v-if="!canAddSelectedItem"
              class="text-[0.8125rem] font-semibold text-[var(--store-text-muted)]"
            >
              Indisponível
            </span>
          </p>

          <div class="mt-5 space-y-5">
            <!-- 4. Variant -->
            <div v-if="activeVariants.length > 0" class="space-y-2.5">
              <div class="flex items-baseline justify-between gap-2">
                <p class="text-sm font-semibold text-[var(--store-text)]">
                  Cor: <span class="font-normal text-[var(--store-text-muted)]">{{ selectedVariant?.name || 'selecione' }}</span>
                </p>
                <p
                  v-if="selectedVariant"
                  class="text-[0.75rem] font-medium"
                  :class="selectedVariantAvailableStock > 0 ? 'text-[var(--store-text-muted)]' : 'text-[var(--store-text-muted)]'"
                >
                  {{ selectedVariantAvailableStock > 0 ? `${selectedVariantAvailableStock} disponíveis` : 'Esgotada' }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="variant in activeVariants"
                  :key="variant.id"
                  type="button"
                  class="relative inline-flex h-11 w-11 items-center justify-center rounded-full border-2 bg-[var(--store-surface)] transition focus:outline-none"
                  :class="selectedVariant?.id === variant.id
                    ? 'border-[var(--store-brand-on-light)]'
                    : 'border-[var(--store-border)] hover:border-[var(--store-brand-on-light)]'"
                  :disabled="variantAvailableStock(variant) <= 0"
                  :aria-label="`Selecionar cor ${variant.name}`"
                  :aria-pressed="selectedVariant?.id === variant.id"
                  :title="variant.name"
                  @click="handleSelectVariant(variant)"
                >
                  <span
                    class="h-7 w-7 rounded-full border border-black/10"
                    :class="{ 'opacity-30': variantAvailableStock(variant) <= 0 }"
                    :style="{ backgroundColor: variant.color_hex }"
                    aria-hidden="true"
                  />
                  <span
                    v-if="variantAvailableStock(variant) <= 0"
                    class="pointer-events-none absolute inset-x-1 top-1/2 h-px -rotate-45 bg-[var(--store-text-muted)]"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <!-- 5. Quantity -->
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-[var(--store-text)]">Quantidade</p>
                <p v-if="cartQuantity > 0" class="mt-0.5 text-[0.75rem] text-[var(--store-text-muted)]">
                  {{ cartQuantity }} já no pedido
                </p>
              </div>
              <div class="inline-flex h-11 items-center rounded-[var(--store-radius-md)] border border-[var(--store-border)] bg-[var(--store-surface)]">
                <button
                  type="button"
                  class="inline-flex h-11 w-11 items-center justify-center rounded-l-[var(--store-radius-md)] text-[var(--store-text-muted)] transition hover:text-[var(--store-text)] disabled:opacity-35"
                  :disabled="!canAddSelectedItem || quantity <= 1"
                  aria-label="Diminuir quantidade"
                  @click="decrementQuantity"
                >
                  <MinusIcon class="h-4 w-4" aria-hidden="true" />
                </button>
                <span class="min-w-9 text-center text-base font-semibold text-[var(--store-text)]">{{ quantity }}</span>
                <button
                  type="button"
                  class="inline-flex h-11 w-11 items-center justify-center rounded-r-[var(--store-radius-md)] text-[var(--store-text-muted)] transition hover:text-[var(--store-text)] disabled:opacity-35"
                  :disabled="!canAddSelectedItem || quantity >= currentAvailableStock"
                  aria-label="Aumentar quantidade"
                  @click="incrementQuantity"
                >
                  <PlusIcon class="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <!-- 6. CTA (desktop in-flow; mobile uses the sticky bar) -->
            <div class="hidden lg:block">
              <StorefrontButton
                size="lg"
                block
                :disabled="!canAddSelectedItem"
                @click="handleAddToCart"
              >
                <ShoppingBagIcon class="h-5 w-5 shrink-0" aria-hidden="true" />
                {{ addToCartLabel }}
              </StorefrontButton>
            </div>
          </div>

          <!-- 7. Description + details -->
          <div class="mt-6 space-y-4 border-t border-[var(--store-border)] pt-5">
            <p class="text-sm leading-6 text-[var(--store-text-muted)]">{{ productDescription }}</p>
            <dl class="divide-y divide-[var(--store-border)] border-y border-[var(--store-border)] text-[0.8125rem]">
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="text-[var(--store-text-muted)]">Tamanho</dt>
                <dd class="font-medium text-[var(--store-text)]">{{ product.size || 'Sob consulta' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="text-[var(--store-text-muted)]">SKU</dt>
                <dd class="font-medium text-[var(--store-text)]">{{ product.sku || 'Não informado' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="text-[var(--store-text-muted)]">Estoque</dt>
                <dd class="font-medium text-[var(--store-text)]">
                  {{ currentAvailableStock > 0 ? `${currentAvailableStock} un.` : 'Indisponível' }}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <StorefrontFooter
        :store-name="storeBranding.name"
        :tagline="storeBranding.tagline"
        :merchant="storefrontAppearance?.merchant"
      >
        <template #feedback>
          <FeedbackTrigger :product-id="feedbackProductId" type="product" />
        </template>
      </StorefrontFooter>
    </main>

    <!-- Mobile sticky purchase bar: keeps the primary action thumb-reachable
         while the shopper reads the description. Desktop uses the in-flow CTA. -->
    <div
      v-if="product && !isLoading && !errorMessage"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--store-border)] bg-[var(--store-surface)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 lg:hidden"
    >
      <div class="mx-auto flex max-w-7xl items-center gap-3">
        <div class="min-w-0">
          <p class="text-[0.6875rem] text-[var(--store-text-muted)]">
            {{ quantity > 1 ? `${quantity} un.` : 'Total' }}
          </p>
          <p class="truncate text-base font-semibold text-[var(--store-text)]">{{ formatBRL(stickyLineTotal) }}</p>
        </div>
        <StorefrontButton
          class="flex-1"
          size="lg"
          :disabled="!canAddSelectedItem"
          @click="handleAddToCart"
        >
          <ShoppingBagIcon class="h-5 w-5 shrink-0" aria-hidden="true" />
          {{ canAddSelectedItem ? 'Adicionar' : 'Indisponível' }}
        </StorefrontButton>
      </div>
    </div>

    <CartDrawer
      :is-open="isCartOpen"
      :items="items"
      :item-count="itemCount"
      :subtotal="subtotal"
      :delivery-fee="deliveryFee"
      :total="total"
      :customer="customer"
      :delivery-regions="deliveryRegions"
      :is-delivery-regions-loading="isDeliveryRegionsLoading"
      :is-submitting="isSubmittingOrder"
      :is-whats-app-configured="isWhatsAppConfigured"
      :profile="customerProfile"
      @close="isCartOpen = false"
      @clear-cart="clearCart"
      @remove-item="removeItem"
      @update-quantity="updateQuantity"
      @update-customer="updateCustomer"
      @submit-order="handleSubmitOrder"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeftIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  ShareIcon,
} from '@heroicons/vue/24/outline'
import { useRoute, useRouter } from 'vue-router'
import CartDrawer from './CartDrawer.vue'
import CustomerProfileMenuButton from './CustomerProfileMenuButton.vue'
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger.vue'
import StorefrontButton from '@/components/storefront/StorefrontButton.vue'
import StorefrontFooter from '@/components/storefront/StorefrontFooter.vue'
import StorefrontHeader from '@/components/storefront/StorefrontHeader.vue'
import StorefrontSkeleton from '@/components/storefront/StorefrontSkeleton.vue'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useStoreTheme } from '@/composables/useStoreTheme'
import { useStorefrontDocumentMeta } from '@/composables/useStorefrontDocumentMeta'
import { useToast } from '@/composables/useToast'
import { PublicRoutes } from '@/router/public.routes'
import { authService } from '@/services/auth.service'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { Logger } from '@/services/logger'
import { extractCheckoutErrorMessage, orderService } from '@/services/order.service'
import productService from '@/services/product.service'
import { setSelectedStoreSlug } from '@/services/store-scope'
import { storeSettingsService } from '@/services/store-settings.service'
import type { DeliveryRegion } from '@/types/delivery'
import type { ProductDetail, ProductVariant } from '@/types/product'
import { formatBRL } from '@/utils/formatters'
import { displayPrice, effectiveUnitPrice } from '@/utils/pricing'
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productImagePlaceholder'
import { buildPublicProductUrl } from '@/utils/publicStorefrontUrl'
import { applyStorefrontFavicon } from '@/utils/storefrontFavicon'

const route = useRoute()
const router = useRouter()
const routeStoreSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
if (routeStoreSlug) {
  setSelectedStoreSlug(routeStoreSlug)
}
const currentRouteStoreSlug = computed(() => (
  typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
))
const toast = useToast()
const { profile: customerProfile, fetchCustomerProfile } = useCustomerProfile()
const { selectedStore, fetchCurrentStore } = useCurrentStore()
const publicStoreSlug = computed(() => currentRouteStoreSlug.value || selectedStore.value?.slug || null)
const { appearance: storefrontAppearance } = usePublicStorefrontAppearance(publicStoreSlug)
const storeBranding = useStoreTheme(selectedStore, storefrontAppearance)

const catalogRoute = computed(() => {
  const storeSlug = currentRouteStoreSlug.value
  return storeSlug
    ? { name: PublicRoutes.StoreProducts, params: { storeSlug } }
    : { name: PublicRoutes.Products }
})

watch(
  () => storefrontAppearance.value?.favicon_url,
  (faviconUrl) => {
    applyStorefrontFavicon(faviconUrl)
  },
  { immediate: true },
)

const FALLBACK_IMAGE_URL = PRODUCT_IMAGE_PLACEHOLDER
const product = ref<ProductDetail | null>(null)
const feedbackProductId = computed(() => product.value?.id ?? null)

useStorefrontDocumentMeta({
  storeName: computed(() => (selectedStore.value ? storeBranding.value.name : null)),
  description: computed(
    () => storefrontAppearance.value?.tagline || storeBranding.value.tagline || null,
  ),
  suffix: computed(() => product.value?.name ?? null),
})
const deliveryRegions = ref<DeliveryRegion[]>([])
const storeWhatsAppPhone = ref('')
const activeImage = ref<string | null>(null)
const selectedVariantId = ref<number | null>(null)
const isLoading = ref(true)
const isCartOpen = ref(false)

// Guest checkout reinstated: refresh the profile whenever the cart opens so
// CartDrawer decides which fields to show from fresh data (covers switching
// stores mid-SPA-session without a reload). Guard matches
// CustomerProfileMenuButton's own pattern so an anonymous visitor never
// fires a doomed 401 fetch.
function openCart(): void {
  isCartOpen.value = true
  if (authService.isAuthenticated()) {
    void fetchCustomerProfile()
  }
}

const isSubmittingOrder = ref(false)
const isDeliveryRegionsLoading = ref(false)
const errorMessage = ref('')
const quantity = ref(1)
const slideTransitionName = ref('carousel-slide-next')
const isCarouselPaused = ref(false)
const isShareCopied = ref(false)
const pointerStartX = ref<number | null>(null)
const pointerDeltaX = ref(0)
const activePointerId = ref<number | null>(null)
let carouselInterval: ReturnType<typeof setInterval> | null = null
let shareFeedbackTimeout: ReturnType<typeof setTimeout> | null = null

const {
  items,
  customer,
  itemCount,
  subtotal,
  deliveryFee,
  total,
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  updateCustomer,
  resetCustomer,
  getProductQuantity,
} = useCart()

const productDescription = computed(() => (
  product.value?.description?.trim()
    || 'Peca selecionada para uma compra simples, com informacoes essenciais reunidas em uma unica tela.'
))

const activeVariants = computed<ProductVariant[]>(() =>
  [...(product.value?.variants ?? [])]
    .filter((variant) => variant.is_active)
    .sort((left, right) => left.position - right.position || left.id - right.id)
)

const hasActiveVariants = computed(() => activeVariants.value.length > 0)

const selectedVariant = computed<ProductVariant | null>(() => {
  if (selectedVariantId.value === null) {
    return null
  }

  return activeVariants.value.find((variant) => variant.id === selectedVariantId.value) ?? null
})

// The detail view always has a variant auto-selected once variants load
// (selectInitialVariant), so the header shows that variant's effective price
// and updates the instant another colour is picked. `from` covers the brief
// pre-selection frame / a product with no active variants. Checkout still
// recomputes the real total server-side.
const headerPrice = computed<{ amount: string; from: boolean }>(() => {
  if (!product.value) {
    return { amount: '0', from: false }
  }

  if (selectedVariant.value) {
    return {
      amount: effectiveUnitPrice(product.value, selectedVariant.value),
      from: false,
    }
  }

  return displayPrice(product.value)
})

function variantAvailableStock(variant: ProductVariant): number {
  if (!product.value?.is_available) {
    return 0
  }

  const variantStock = Math.max(0, Math.trunc(Number(variant.stock_quantity) || 0))
  return Math.min(product.value.stock_quantity, variantStock)
}

const selectedVariantAvailableStock = computed(() => (
  selectedVariant.value ? variantAvailableStock(selectedVariant.value) : 0
))

const currentAvailableStock = computed(() => {
  if (!product.value?.is_available) {
    return 0
  }

  if (!hasActiveVariants.value) {
    return product.value.stock_quantity
  }

  return selectedVariantAvailableStock.value
})

const canAddSelectedItem = computed(() => currentAvailableStock.value > 0)

const productImages = computed(() => {
  const productGallery = product.value?.images?.length
    ? product.value.images
    : product.value?.image
      ? [product.value.image]
      : []
  const variantImage = selectedVariant.value?.image || null
  const gallery = variantImage
    ? [variantImage, ...productGallery.filter((imageUrl) => imageUrl !== variantImage)]
    : productGallery

  return gallery.length > 0 ? gallery : [FALLBACK_IMAGE_URL]
})

const activeImageSource = computed(() => (
  activeImage.value && productImages.value.includes(activeImage.value)
    ? activeImage.value
    : productImages.value[0]
))

function stopCarousel(): void {
  if (!carouselInterval) {
    return
  }

  clearInterval(carouselInterval)
  carouselInterval = null
}

function setActiveImageByIndex(nextIndex: number, direction: 'next' | 'prev'): void {
  slideTransitionName.value = direction === 'next'
    ? 'carousel-slide-next'
    : 'carousel-slide-prev'
  activeImage.value = productImages.value[nextIndex] ?? FALLBACK_IMAGE_URL
}

function goToNextImage(): void {
  if (productImages.value.length <= 1) {
    return
  }

  const currentIndex = productImages.value.findIndex((imageUrl) => imageUrl === activeImageSource.value)
  const nextIndex = currentIndex >= 0
    ? (currentIndex + 1) % productImages.value.length
    : 0

  setActiveImageByIndex(nextIndex, 'next')
}

function goToPreviousImage(): void {
  if (productImages.value.length <= 1) {
    return
  }

  const currentIndex = productImages.value.findIndex((imageUrl) => imageUrl === activeImageSource.value)
  const previousIndex = currentIndex >= 0
    ? (currentIndex - 1 + productImages.value.length) % productImages.value.length
    : 0

  setActiveImageByIndex(previousIndex, 'prev')
}

function startCarousel(): void {
  stopCarousel()

  if (productImages.value.length <= 1 || isCarouselPaused.value) {
    return
  }

  carouselInterval = setInterval(() => {
    goToNextImage()
  }, 3500)
}

function handleSelectImage(imageUrl: string): void {
  const currentIndex = productImages.value.findIndex((item) => item === activeImageSource.value)
  const nextIndex = productImages.value.findIndex((item) => item === imageUrl)

  slideTransitionName.value = nextIndex >= currentIndex
    ? 'carousel-slide-next'
    : 'carousel-slide-prev'

  activeImage.value = imageUrl
  startCarousel()
}

function pauseCarousel(): void {
  isCarouselPaused.value = true
  stopCarousel()
}

function resumeCarousel(): void {
  isCarouselPaused.value = false
  startCarousel()
}

function selectInitialVariant(): void {
  selectedVariantId.value = (
    activeVariants.value.find((variant) => variantAvailableStock(variant) > 0)
    ?? activeVariants.value[0]
  )?.id ?? null
}

function handleSelectVariant(variant: ProductVariant): void {
  selectedVariantId.value = variant.id
  activeImage.value = variant.image || productImages.value[0] || FALLBACK_IMAGE_URL
  startCarousel()
}

function handlePointerDown(event: PointerEvent): void {
  if (productImages.value.length <= 1) {
    return
  }

  activePointerId.value = event.pointerId
  pointerStartX.value = event.clientX
  pointerDeltaX.value = 0
  pauseCarousel()
}

function handlePointerMove(event: PointerEvent): void {
  if (activePointerId.value !== event.pointerId || pointerStartX.value === null) {
    return
  }

  pointerDeltaX.value = event.clientX - pointerStartX.value
}

function finalizePointerInteraction(): void {
  const swipeThreshold = 48

  if (pointerDeltaX.value <= -swipeThreshold) {
    goToNextImage()
  } else if (pointerDeltaX.value >= swipeThreshold) {
    goToPreviousImage()
  }

  pointerStartX.value = null
  pointerDeltaX.value = 0
  activePointerId.value = null
  resumeCarousel()
}

function handlePointerUp(event: PointerEvent): void {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  finalizePointerInteraction()
}

function handlePointerCancel(): void {
  pointerStartX.value = null
  pointerDeltaX.value = 0
  activePointerId.value = null
  resumeCarousel()
}

function handlePointerLeave(event: PointerEvent): void {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  finalizePointerInteraction()
}

const cartQuantity = computed(() => (
  product.value ? getProductQuantity(product.value.id, selectedVariant.value?.id ?? null) : 0
))

const isWhatsAppConfigured = computed(() => storeWhatsAppPhone.value.length > 0)

// Running line total for the mobile sticky purchase bar (display only --
// the backend recomputes the real price at checkout).
const stickyLineTotal = computed(() => {
  const unit = Number(headerPrice.value.amount) || 0
  return String(unit * Math.max(1, quantity.value))
})

const addToCartLabel = computed(() => {
  if (!canAddSelectedItem.value) {
    return 'Indisponível'
  }

  if (quantity.value > 1) {
    return `Adicionar ${quantity.value}`
  }

  return 'Adicionar ao pedido'
})

function getProductShareUrl(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const storeSlug = typeof route.params.storeSlug === 'string' ? route.params.storeSlug : ''
  const slug = typeof route.params.slug === 'string' ? route.params.slug : ''
  const code = typeof route.params.code === 'string' ? route.params.code : ''

  return buildPublicProductUrl({
    runtimeOrigin: window.location.origin,
    storeSlug,
    productSlug: slug,
    productCode: code,
  }) || ''
}

function isShareAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

function clearShareCopiedFeedback(): void {
  if (shareFeedbackTimeout) {
    clearTimeout(shareFeedbackTimeout)
    shareFeedbackTimeout = null
  }

  isShareCopied.value = false
}

function showShareCopiedFeedback(): void {
  clearShareCopiedFeedback()
  isShareCopied.value = true
  shareFeedbackTimeout = setTimeout(() => {
    isShareCopied.value = false
    shareFeedbackTimeout = null
  }, 2200)
}

async function copyProductShareUrl(shareUrl: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(shareUrl)
    showShareCopiedFeedback()
    toast.success('Link do produto copiado.')
    return true
  } catch (error) {
    Logger.warn('Failed to copy public product share URL', {
      shareUrl,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return false
  }
}

async function handleShareProduct(): Promise<void> {
  if (!product.value) {
    return
  }

  const shareUrl = getProductShareUrl()

  if (!shareUrl) {
    toast.error('Nao foi possivel compartilhar o link agora.')
    return
  }

  const sharePayload = {
    title: product.value.name,
    text: `${product.value.name} • ${formatBRL(headerPrice.value.amount)}`,
    url: shareUrl,
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(sharePayload)
      return
    } catch (error) {
      if (isShareAbortError(error)) {
        return
      }

      Logger.warn('Native public product share failed, falling back to clipboard', {
        shareUrl,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  const copied = await copyProductShareUrl(shareUrl)

  if (!copied) {
    toast.error('Nao foi possivel compartilhar o link agora.')
  }
}

async function loadProduct(): Promise<void> {
  const slug = typeof route.params.slug === 'string' ? route.params.slug : ''
  // Etapa 4 of the QR-code stock-exit evolution: a printed QR's deep-link
  // URL (/l/:storeSlug/p/:code) resolves the product by its public_code
  // instead of by slug -- same view, different lookup key.
  const code = typeof route.params.code === 'string' ? route.params.code : ''

  if (!slug && !code) {
    errorMessage.value = 'Produto invalido.'
    isLoading.value = false
    return
  }

  isLoading.value = true
  errorMessage.value = ''

  try {
    product.value = code
      ? await productService.getPublicByCode(code)
      : await productService.getPublicBySlug(slug)
    selectInitialVariant()
    activeImage.value = productImages.value[0] || FALLBACK_IMAGE_URL
    quantity.value = 1
    isCarouselPaused.value = false
    startCarousel()
  } catch (error) {
    product.value = null
    stopCarousel()
    errorMessage.value = 'Nao encontramos os detalhes deste produto agora.'
    Logger.warn('Failed to load public product detail', {
      slug,
      code,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  } finally {
    isLoading.value = false
  }
}

async function loadStoreSettings(): Promise<void> {
  try {
    const settings = await storeSettingsService.getPublic()
    storeWhatsAppPhone.value = settings.whatsapp_phone_digits
  } catch (error) {
    storeWhatsAppPhone.value = ''
    Logger.warn('Failed to load public store settings from product detail', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

async function loadDeliveryRegions(): Promise<void> {
  isDeliveryRegionsLoading.value = true

  try {
    deliveryRegions.value = await deliveryRegionService.getActive()

    const selectedRegion = deliveryRegions.value.find(
      (region) => region.id === customer.value.deliveryRegionId
    )

    if (customer.value.deliveryRegionId && !selectedRegion) {
      updateCustomer({
        deliveryRegionId: null,
        deliveryRegionName: '',
        deliveryRegionFee: 0,
      })
    }

    if (
      customer.value.deliveryMethod === 'delivery'
      && !customer.value.deliveryRegionId
      && deliveryRegions.value.length === 1
    ) {
      const [region] = deliveryRegions.value
      if (!region) {
        return
      }

      updateCustomer({
        deliveryRegionId: region.id,
        deliveryRegionName: region.name,
        deliveryRegionFee: Number(region.delivery_fee),
      })
    }
  } catch (error) {
    deliveryRegions.value = []
    Logger.warn('Failed to load public delivery regions from product detail', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  } finally {
    isDeliveryRegionsLoading.value = false
  }
}

onMounted(() => {
  void Promise.allSettled([
    fetchCurrentStore(),
    loadDeliveryRegions(),
    loadStoreSettings(),
  ])
})

watch(productImages, (nextImages) => {
  if (!nextImages.includes(activeImage.value || '')) {
    activeImage.value = nextImages[0] || FALLBACK_IMAGE_URL
  }
  startCarousel()
})

watch(currentAvailableStock, (nextStock) => {
  quantity.value = Math.min(quantity.value, Math.max(nextStock, 1))
})

watch(
  () => route.params.slug,
  () => {
    void loadProduct()
  },
  { immediate: true }
)

// Separate watcher (not merged with the one above) because Vue's watch only
// re-fires when the *watched* value itself changes -- navigating between
// two code-anchored products never touches route.params.slug (always
// undefined on this route), so that watcher alone would miss it.
watch(
  () => route.params.code,
  (code) => {
    if (typeof code === 'string' && code.trim()) {
      void loadProduct()
    }
  }
)

watch(
  () => route.params?.storeSlug,
  (storeSlug) => {
    if (typeof storeSlug === 'string' && storeSlug.trim()) {
      setSelectedStoreSlug(storeSlug)
      void Promise.allSettled([
        fetchCurrentStore(true),
        loadDeliveryRegions(),
        loadStoreSettings(),
        loadProduct(),
      ])
    }
  }
)

function handleImageError(event: Event): void {
  const img = event.target as HTMLImageElement
  if (img.src !== FALLBACK_IMAGE_URL) {
    img.src = FALLBACK_IMAGE_URL
    activeImage.value = FALLBACK_IMAGE_URL
  }
}

function incrementQuantity(): void {
  if (!product.value || !canAddSelectedItem.value) {
    return
  }

  quantity.value = Math.min(quantity.value + 1, currentAvailableStock.value)
}

function decrementQuantity(): void {
  quantity.value = Math.max(quantity.value - 1, 1)
}

function handleAddToCart(): void {
  if (!product.value || !canAddSelectedItem.value) {
    return
  }

  addItem(product.value, quantity.value, selectedVariant.value)
  const variantLabel = selectedVariant.value?.name ? ` - ${selectedVariant.value.name}` : ''
  // Ciclo 8: same dedup key as ProductsView's add-to-cart toast -- repeated
  // or cross-page quick adds update one toast in place.
  toast.success(`${quantity.value} unidade(s) de ${product.value.name}${variantLabel} adicionada(s) ao pedido.`, undefined, 'cart-add')
  quantity.value = 1
}

function goBackToCatalog(): void {
  const storeSlug = typeof route.params.storeSlug === 'string' ? route.params.storeSlug : ''

  void router.push(
    storeSlug
      ? { name: PublicRoutes.StoreProducts, params: { storeSlug } }
      : { name: PublicRoutes.Products }
  )
}

function canOpenWhatsAppCheckout(): boolean {
  if (items.value.length === 0) {
    toast.info('Adicione produtos ao pedido antes de finalizar pelo WhatsApp.')
    return false
  }

  if (!isWhatsAppConfigured.value) {
    toast.info('WhatsApp da loja ainda nao configurado.')
    return false
  }

  return true
}

async function handleSubmitOrder(): Promise<void> {
  if (!canOpenWhatsAppCheckout() || isSubmittingOrder.value) {
    return
  }

  isSubmittingOrder.value = true

  try {
    const checkout = await orderService.checkoutViaWhatsApp(items.value, customer.value)

    if (!checkout.whatsapp_url) {
      toast.error('Nao foi possivel abrir o WhatsApp da loja. Seu carrinho foi mantido.')
      return
    }

    const openedWindow = window.open(checkout.whatsapp_url, '_blank', 'noopener,noreferrer')
    if (!openedWindow) {
      window.location.href = checkout.whatsapp_url
    }
    toast.success(`Pedido ${checkout.order_reference} registrado. Abrimos o WhatsApp para atendimento.`)

    clearCart()
    resetCustomer()
    isCartOpen.value = false
    await loadProduct()
  } catch (error) {
    Logger.warn('Failed to register WhatsApp checkout from product detail', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    toast.error(extractCheckoutErrorMessage(error))
  } finally {
    isSubmittingOrder.value = false
  }
}

onBeforeUnmount(() => {
  stopCarousel()
  clearShareCopiedFeedback()
})
</script>

<style scoped>
.carousel-slide-next-enter-active,
.carousel-slide-next-leave-active,
.carousel-slide-prev-enter-active,
.carousel-slide-prev-leave-active {
  transition: transform 0.4s ease, opacity 0.4s ease;
}

.carousel-slide-next-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.carousel-slide-next-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

.carousel-slide-prev-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.carousel-slide-prev-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
