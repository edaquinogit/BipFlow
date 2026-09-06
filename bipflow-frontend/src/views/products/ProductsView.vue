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
    <header class="storefront-header border-b">
      <div class="mx-auto max-w-7xl px-4 py-3.5 min-[390px]:py-4 sm:px-6 lg:px-8">
        <div class="flex flex-col gap-3 min-[390px]:gap-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2.5 min-[390px]:gap-3">
            <div class="flex h-11 w-28 shrink-0 items-center justify-center overflow-hidden min-[390px]:h-12 min-[390px]:w-32">
              <img
                :src="storeBranding.logoUrl"
                :alt="storeBranding.name"
                class="h-full w-full object-contain"
              />
            </div>
            <div class="min-w-0">
              <p class="brand-wordmark brand-wordmark-premium truncate text-lg min-[390px]:text-xl">{{ storeBranding.name }}</p>
              <p class="storefront-muted truncate text-xs min-[390px]:text-sm">{{ storeBranding.tagline }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2.5 sm:flex-row">
            <CustomerProfileMenuButton />

            <button
              type="button"
              data-cy="open-cart-button"
              class="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3.5 whitespace-nowrap text-[11px] font-bold uppercase leading-[1.15] tracking-[0.14em] transition focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] min-[390px]:px-4 min-[390px]:text-xs"
              :class="itemCount > 0
                ? 'storefront-primary-button shadow-[0_12px_28px_-18px_rgba(5,5,10,0.8)]'
                : 'storefront-outline-button bg-white'"
              @click="openCart"
            >
              <ShoppingBagIcon class="h-4 w-4" aria-hidden="true" />
              <span>Pedido</span>
              <span class="whitespace-nowrap" :class="itemCount > 0 ? 'text-white/75' : 'text-[#6B7280]'">
                {{ itemCount }} item<span v-if="itemCount !== 1">s</span>
              </span>
              <span class="whitespace-nowrap font-bold">{{ formatBRL(subtotal) }}</span>
            </button>
          </div>
        </div>

        <div class="storefront-panel relative mt-4 rounded-[1.15rem] border p-2.5 min-[390px]:mt-5 min-[390px]:rounded-xl min-[390px]:p-3">
          <div class="flex items-center gap-2">
            <label class="relative min-w-0 flex-1">
              <span class="sr-only">Buscar produtos</span>
              <MagnifyingGlassIcon
                class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9CA3AF]"
                aria-hidden="true"
              />
              <input
                :value="filters.search"
                type="search"
                class="h-10 w-full rounded-full border border-transparent bg-[#F3F4F6] pl-10 pr-4 text-sm text-[#05050A] outline-none transition placeholder:text-[#9CA3AF] focus:border-[var(--store-primary)] focus:bg-white focus:ring-2 focus:ring-[var(--store-primary-soft)] min-[390px]:h-11"
                placeholder="Buscar produto"
                aria-label="Buscar produtos por nome"
                @input="handleSearchInput"
              />
            </label>

            <button
              type="button"
              :aria-expanded="isFiltersOpen"
              aria-label="Abrir filtros"
              class="group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-transparent bg-[#F3F4F6] text-[#6B7280] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--store-primary-soft)] hover:text-[var(--store-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] min-[390px]:h-11 min-[390px]:w-11"
              @click="toggleFilters"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          </div>

          <!-- Glass Morphism Filters Drawer -->
          <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 translate-y-2"
          >
            <div v-if="isFiltersOpen" class="absolute left-0 right-0 top-full z-40 mx-2.5 mt-2 min-[390px]:mx-3 lg:mx-4">
              <!-- Overlay backdrop -->
              <div class="fixed inset-0 bg-black/10 backdrop-blur-sm" @click="isFiltersOpen = false" />

              <!-- Glass panel -->
              <div class="relative mx-auto max-w-2xl rounded-[1.35rem] border border-white/40 bg-white/80 p-3.5 shadow-2xl backdrop-blur-xl min-[390px]:rounded-2xl min-[390px]:p-4 sm:p-6">
                <div class="grid gap-4 min-[390px]:gap-6 sm:grid-cols-2">
                  <!-- Sort -->
                  <div>
                    <label class="mb-2.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6B7280] min-[390px]:mb-3 min-[390px]:text-xs">
                      Ordenação
                    </label>
                    <select
                      v-model="sortBy"
                      class="w-full rounded-xl border border-[#D1D5DB] bg-white/50 px-3 py-2.5 text-sm text-[#05050A] outline-none transition focus:border-[var(--store-primary)] focus:ring-2 focus:ring-[var(--store-primary-soft)]"
                    >
                      <option value="featured">Mais relevantes</option>
                      <option value="price-asc">Menor preço</option>
                      <option value="price-desc">Maior preço</option>
                      <option value="name-asc">Nome A-Z</option>
                      <option value="newest">Mais recentes</option>
                    </select>
                  </div>

                  <!-- Stock Filter -->
                  <div>
                    <label class="mb-2.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6B7280] min-[390px]:mb-3 min-[390px]:text-xs">
                      Disponibilidade
                    </label>
                    <label class="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        :checked="draftInStockOnly"
                        class="w-4 h-4 rounded border-[#D1D5DB] text-[var(--store-primary)] focus:ring-2 focus:ring-[var(--store-primary-soft)]"
                        @change="handleStockFilterToggle"
                      />
                      <span class="text-sm text-[#6B7280]">Em estoque</span>
                    </label>
                  </div>
                </div>

                <!-- Categories -->
                <div class="mt-5 border-t border-white/20 pt-5 min-[390px]:mt-6 min-[390px]:pt-6">
                  <label class="mb-2.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6B7280] min-[390px]:mb-3 min-[390px]:text-xs">
                    Categorias
                  </label>
                  <div class="flex flex-wrap gap-1.5 min-[390px]:gap-2">
                    <button
                      type="button"
                      class="rounded-full px-3 py-1.5 text-[11px] font-bold uppercase leading-[1.15] tracking-[0.12em] transition-all duration-200"
                      :class="!draftCategoryId
                        ? 'bg-[var(--store-primary)] text-white shadow-md'
                        : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[var(--store-primary-soft)] hover:text-[var(--store-primary)]'"
                      @click="handleQuickCategory(undefined)"
                    >
                      Todas
                    </button>

                    <button
                      v-for="category in categories"
                      :key="category.id"
                      type="button"
                      class="rounded-full px-3 py-1.5 text-[11px] font-bold uppercase leading-[1.15] tracking-[0.12em] transition-all duration-200"
                      :class="draftCategoryId === category.id
                        ? 'bg-[var(--store-primary)] text-white shadow-md'
                        : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[var(--store-primary-soft)] hover:text-[var(--store-primary)]'"
                      @click="handleQuickCategory(category.id)"
                    >
                      {{ category.name }}
                    </button>
                  </div>
                </div>

                <!-- Save / Cancel -->
                <div class="mt-5 flex items-center justify-end gap-2.5 border-t border-white/20 pt-4 min-[390px]:mt-6 min-[390px]:gap-3">
                  <button
                    type="button"
                    class="storefront-outline-button inline-flex h-10 items-center justify-center rounded-xl border bg-white px-4 whitespace-nowrap text-[11px] font-bold uppercase leading-[1.15] tracking-[0.14em] transition focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] min-[390px]:text-xs"
                    @click="handleCancelFilters"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    class="storefront-primary-button inline-flex h-10 items-center justify-center rounded-xl px-5 whitespace-nowrap text-[11px] font-bold uppercase leading-[1.15] tracking-[0.14em] text-white shadow-[0_12px_28px_-18px_rgba(5,5,10,0.8)] transition focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] min-[390px]:text-xs"
                    @click="handleSaveFilters"
                  >
                    Salvar
                  </button>
                </div>

                <!-- Close button -->
                <button
                  type="button"
                  @click="isFiltersOpen = false"
                  class="absolute top-3 right-3 text-[#9CA3AF] hover:text-[var(--store-primary)] transition-colors"
                  aria-label="Fechar filtros"
                >
                  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <main
      class="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8"
      :aria-busy="isLoading ? 'true' : 'false'"
    >
      <p class="sr-only" aria-live="polite">{{ liveRegionMessage }}</p>

      <section
        v-if="heroAppearance"
        data-cy="storefront-hero-banner"
        class="mb-5 overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-surface)] shadow-[var(--store-card-shadow)] min-[390px]:mb-6"
      >
        <picture>
          <source
            v-if="heroAppearance.hero_image_mobile"
            :srcset="heroAppearance.hero_image_mobile"
            media="(max-width: 640px)"
          />
          <img
            :src="heroAppearance.hero_image_desktop"
            :alt="heroAppearance.hero_alt_text || storeBranding.name"
            class="aspect-[16/7] w-full object-cover"
            loading="eager"
          />
        </picture>

        <div
          v-if="heroAppearance.hero_title || heroAppearance.hero_subtitle || (heroAppearance.hero_cta_text && heroAppearance.hero_cta_url)"
          class="flex flex-col gap-3 border-t border-[var(--store-border)] px-4 py-4 min-[390px]:px-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <h2
              v-if="heroAppearance.hero_title"
              class="text-lg font-semibold leading-tight text-[var(--store-text)] min-[390px]:text-xl"
            >
              {{ heroAppearance.hero_title }}
            </h2>
            <p
              v-if="heroAppearance.hero_subtitle"
              class="mt-1 text-sm leading-5 text-[var(--store-text-muted)]"
            >
              {{ heroAppearance.hero_subtitle }}
            </p>
          </div>

          <a
            v-if="heroAppearance.hero_cta_text && heroAppearance.hero_cta_url"
            :href="heroAppearance.hero_cta_url"
            target="_blank"
            rel="noopener"
            class="storefront-primary-button inline-flex h-11 shrink-0 items-center justify-center rounded-[var(--store-radius-md)] px-4 text-[11px] font-bold uppercase tracking-[0.14em] focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)]"
          >
            {{ heroAppearance.hero_cta_text }}
          </a>
        </div>
      </section>

      <section
        v-if="storefrontBanners.length"
        data-cy="storefront-promotional-banners"
        class="mb-5 grid gap-3 min-[390px]:mb-6 md:grid-cols-2"
      >
        <component
          :is="banner.button_url ? 'a' : 'div'"
          v-for="banner in storefrontBanners"
          :key="`${banner.position}-${banner.image_url}`"
          :href="banner.button_url || undefined"
          class="group overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-surface)] shadow-[var(--store-card-shadow)] transition hover:border-[var(--store-primary)]/45"
        >
          <img
            :src="banner.image_url"
            :alt="banner.alt_text || banner.title || storeBranding.name"
            class="aspect-[5/2] w-full object-cover"
            loading="lazy"
          />
          <div
            v-if="banner.title || banner.subtitle || (banner.cta_text && banner.button_url)"
            class="flex flex-col gap-3 border-t border-[var(--store-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <h2 v-if="banner.title" class="text-sm font-semibold leading-tight text-[var(--store-text)]">
                {{ banner.title }}
              </h2>
              <p v-if="banner.subtitle" class="mt-1 text-xs leading-5 text-[var(--store-text-muted)]">
                {{ banner.subtitle }}
              </p>
            </div>
            <span
              v-if="banner.cta_text && banner.button_url"
              class="storefront-primary-button inline-flex h-9 shrink-0 items-center justify-center rounded-[var(--store-radius-md)] px-3 text-[10px] font-bold uppercase tracking-[0.14em]"
            >
              {{ banner.cta_text }}
            </span>
          </div>
        </component>
      </section>

      <div class="mb-5 flex flex-col gap-2 text-sm text-[#6B7280] min-[390px]:mb-6 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between min-[390px]:gap-4">
        <p>{{ showingRange }}</p>
        <button
          v-if="filters.search || filters.categoryId"
          type="button"
          class="font-medium text-[#05050A] underline-offset-4 hover:text-[var(--store-primary)] hover:underline"
          @click="handleClearFilters"
        >
          Limpar filtros
        </button>
      </div>

      <div v-if="isInitialLoading && products.length === 0" class="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:gap-x-5 xl:grid-cols-4">
        <div
          v-for="n in 8"
          :key="n"
          class="animate-pulse"
        >
          <div class="aspect-[4/5] rounded-lg bg-[#F3F4F6]" />
          <div class="space-y-3 pt-4">
            <div class="h-4 w-2/3 rounded bg-slate-200" />
            <div class="h-7 w-1/2 rounded bg-slate-200" />
            <div class="h-10 rounded-lg bg-slate-200" />
          </div>
        </div>
      </div>

      <div
        v-else-if="error && products.length === 0"
        class="mx-auto max-w-xl py-24 text-center"
      >
        <div class="mb-4 text-red-600">
          <svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h2 class="mb-2 text-lg font-medium text-[#05050A]">Erro ao carregar produtos</h2>
        <p class="mb-6 text-[#6B7280]">{{ error }}</p>
        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Tentar novamente"
            class="inline-flex items-center rounded-lg bg-[#05050A] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--store-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] focus:ring-offset-2"
            @click="retryFetch"
          >
            Tentar novamente
          </button>
          <button
            type="button"
            aria-label="Relatar problema"
            class="inline-flex items-center rounded-lg border border-[#D1D5DB] bg-white px-5 py-3 text-sm font-medium text-[#374151] transition-colors hover:border-[var(--store-primary)] hover:text-[var(--store-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] focus:ring-offset-2"
            @click="handleReportCatalogProblem"
          >
            Relatar problema
          </button>
        </div>
      </div>

      <div
        v-else-if="displayedProducts.length > 0"
        class="storefront-product-grid grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"
        :class="isCompactDensity
          ? 'gap-x-2 gap-y-4 min-[390px]:gap-x-2.5 min-[390px]:gap-y-5 lg:gap-x-4 lg:gap-y-6'
          : 'gap-x-2.5 gap-y-5 min-[390px]:gap-x-3 min-[390px]:gap-y-6 lg:gap-x-5 lg:gap-y-8'"
      >
        <ProductCard
          v-for="product in displayedProducts"
          :key="product.id"
          :product="product"
          :cart-quantity="getProductQuantity(product.id)"
          @add-to-cart="handleAddToCart"
          @open-details="handleOpenDetails"
        />
      </div>

      <div
        v-else
        class="mx-auto max-w-xl py-24 text-center"
      >
        <div class="mb-4 text-slate-400">
          <svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m8-5v2m0 0v2m0-2h2m-2 0h-2"
            />
          </svg>
        </div>
        <h2 class="mb-2 text-lg font-medium text-[#05050A]">Nenhum produto encontrado</h2>
        <p class="mb-6 text-[#6B7280]">
          Escolha outra categoria para continuar explorando.
        </p>
        <button
          type="button"
          aria-label="Limpar filtros"
          class="inline-flex items-center rounded-lg border border-[#D1D5DB] bg-white px-5 py-3 text-sm font-medium text-[#05050A] transition-colors hover:border-[var(--store-primary)] hover:text-[var(--store-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--store-primary-soft)] focus:ring-offset-2"
          @click="handleClearFilters"
        >
          Limpar filtros
        </button>
      </div>

      <div v-if="totalPages > 1" class="mt-8">
        <ProductPagination
          :current-page="page"
          :total-pages="totalPages"
          :has-previous-page="hasPreviousPage"
          :has-next-page="hasNextPage"
          :showing-range="showingRange"
          @go-to-page="handleGoToPage"
          @next-page="nextPage"
          @previous-page="previousPage"
        />
      </div>

      <footer class="mt-10 space-y-4 border-t border-[#E5E7EB] py-6 text-center">
        <StorefrontSocialLinks :merchant="storefrontAppearance?.merchant" />
        <FeedbackTrigger />
      </footer>
    </main>

    <FloatingCartButton
      :item-count="itemCount"
      @open-cart="openCart"
    />

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
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryValue } from 'vue-router'
import { PublicRoutes } from '@/router/public.routes'
import CartDrawer from './CartDrawer.vue'
import CustomerProfileMenuButton from './CustomerProfileMenuButton.vue'
import FloatingCartButton from './FloatingCartButton.vue'
import FeedbackTrigger from '@/components/feedback/FeedbackTrigger.vue'
import ProductCard from './ProductCard.vue'
import ProductPagination from './ProductPagination.vue'
import {
  MagnifyingGlassIcon,
  ShoppingBagIcon,
} from '@heroicons/vue/24/outline'
import { useCart } from '@/composables/useCart'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCustomerFeedback } from '@/composables/useCustomerFeedback'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { useProductSearch } from '@/composables/useProductSearch'
import { usePublicStorefrontAppearance } from '@/composables/usePublicStorefrontAppearance'
import { useStoreTheme } from '@/composables/useStoreTheme'
import { useToast } from '@/composables/useToast'
import type { Category } from '@/schemas/category.schema'
import { authService } from '@/services/auth.service'
import { categoryService } from '@/services/category.service'
import { deliveryRegionService } from '@/services/delivery-region.service'
import { Logger } from '@/services/logger'
import { extractCheckoutErrorMessage, orderService } from '@/services/order.service'
import { setSelectedStoreSlug } from '@/services/store-scope'
import { storeSettingsService } from '@/services/store-settings.service'
import { storefrontAppearanceService } from '@/services/storefront-appearance.service'
import type { DeliveryRegion } from '@/types/delivery'
import { getErrorRequestId } from '@/types/errors'
import type {
  Product,
  ProductFilters as ProductFilterState,
  ProductSortOption,
  ProductVariant,
} from '@/types/product'
import type { PublicStorefrontBanner } from '@/types/store'
import { formatBRL } from '@/utils/formatters'
import { applyStorefrontFavicon } from '@/utils/storefrontFavicon'

function parseNumberParam(
  value: LocationQueryValue | LocationQueryValue[] | undefined
): number | undefined {
  const normalizedValue = Array.isArray(value) ? value[0] : value

  if (typeof normalizedValue !== 'string' || normalizedValue.trim() === '') {
    return undefined
  }

  const parsedValue = Number(normalizedValue)
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined
}

function parseFiltersFromQuery(query: LocationQuery): ProductFilterState {
  return {
    search: typeof query.search === 'string' ? query.search : '',
    categoryId: parseNumberParam(query.category),
    priceMin: parseNumberParam(query.minPrice),
    priceMax: parseNumberParam(query.maxPrice),
    inStockOnly: query.inStockOnly === 'true',
  }
}

function parsePageFromQuery(query: LocationQuery): number {
  const parsedPage = parseNumberParam(query.page)
  return parsedPage && parsedPage >= 1 ? parsedPage : 1
}

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
const { open: openFeedback } = useCustomerFeedback()
const { profile: customerProfile, fetchCustomerProfile } = useCustomerProfile()
const { selectedStore, fetchCurrentStore } = useCurrentStore()
const publicStoreSlug = computed(() => currentRouteStoreSlug.value || selectedStore.value?.slug || null)
const { appearance: storefrontAppearance } = usePublicStorefrontAppearance(publicStoreSlug)
const storeBranding = useStoreTheme(selectedStore, storefrontAppearance)
const categories = ref<Category[]>([])
const storefrontBanners = ref<PublicStorefrontBanner[]>([])
const deliveryRegions = ref<DeliveryRegion[]>([])
const storeWhatsAppPhone = ref('')
const isCartOpen = ref(false)

// Guest checkout reinstated: CartDrawer needs a fresh profile (or null) at
// render time to decide which fields to show, so refresh it whenever the
// cart opens -- covers switching stores mid-SPA-session without a reload.
// authService.isAuthenticated() guard matches CustomerProfileMenuButton's
// own pattern, so an anonymous visitor never fires a doomed 401 fetch.
function openCart(): void {
  isCartOpen.value = true
  if (authService.isAuthenticated()) {
    void fetchCustomerProfile()
  }
}

const isSubmittingOrder = ref(false)
const isDeliveryRegionsLoading = ref(false)
const sortBy = ref<ProductSortOption>('featured')
const isFiltersOpen = ref(false)
const draftCategoryId = ref<number | undefined>(undefined)
const draftInStockOnly = ref(false)

const initialFilters = parseFiltersFromQuery(route.query)
const initialPage = parsePageFromQuery(route.query)

const {
  products,
  isLoading,
  isInitialLoading,
  error,
  errorCorrelationId,
  page,
  totalPages,
  filters,
  hasNextPage,
  hasPreviousPage,
  showingRange,
  fetchProducts,
  updateFilters,
  clearFilters,
  goToPage,
  nextPage,
  previousPage,
} = useProductSearch({
  initialFilters,
  initialPage,
})

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

let isSyncingRouteState = false

const displayedProducts = computed(() => {
  const nextProducts = [...products.value]

  switch (sortBy.value) {
    case 'price-asc':
      return nextProducts.sort((left, right) => Number(left.price) - Number(right.price))
    case 'price-desc':
      return nextProducts.sort((left, right) => Number(right.price) - Number(left.price))
    case 'name-asc':
      return nextProducts.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    case 'newest':
      return nextProducts.sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      )
    default:
      return nextProducts
  }
})

const isWhatsAppConfigured = computed(() => storeWhatsAppPhone.value.length > 0)
const isCompactDensity = computed(() => storefrontAppearance.value?.density === 'compact')

const heroAppearance = computed(() => {
  const appearance = storefrontAppearance.value

  if (!appearance?.hero_enabled || !appearance.hero_image_desktop) {
    return null
  }

  return appearance
})

const liveRegionMessage = computed(() => {
  if (isInitialLoading.value) {
    return 'Carregando produtos.'
  }

  if (error.value) {
    return `Erro ao carregar produtos: ${error.value}`
  }

  if (products.value.length === 0) {
    return 'Nenhum produto encontrado.'
  }

  return `${products.value.length} produtos exibidos. ${showingRange.value}`
})

function buildQueryFromState(): Record<string, string> {
  const query: Record<string, string> = {}

  if (filters.value.search?.trim()) {
    query.search = filters.value.search.trim()
  }

  if (filters.value.categoryId) {
    query.category = String(filters.value.categoryId)
  }

  if (filters.value.priceMin !== undefined) {
    query.minPrice = String(filters.value.priceMin)
  }

  if (filters.value.priceMax !== undefined) {
    query.maxPrice = String(filters.value.priceMax)
  }

  if (filters.value.inStockOnly) {
    query.inStockOnly = 'true'
  }

  if (page.value > 1) {
    query.page = String(page.value)
  }

  return query
}

function syncRouteQuery(): void {
  const currentQuery = JSON.stringify(route.query)
  const nextQuery = JSON.stringify(buildQueryFromState())

  if (currentQuery === nextQuery) {
    return
  }

  isSyncingRouteState = true
  router.replace({ query: buildQueryFromState() }).finally(() => {
    isSyncingRouteState = false
  })
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = await categoryService.getAll()
  } catch (err) {
    categories.value = []
    Logger.warn('Failed to load public categories', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  }
}

async function loadStoreSettings(): Promise<void> {
  try {
    const settings = await storeSettingsService.getPublic()
    storeWhatsAppPhone.value = settings.whatsapp_phone_digits
  } catch (err) {
    storeWhatsAppPhone.value = ''
    Logger.warn('Failed to load public store settings', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  }
}

async function loadStorefrontBanners(): Promise<void> {
  const slug = publicStoreSlug.value
  if (!slug) {
    storefrontBanners.value = []
    return
  }

  try {
    storefrontBanners.value = await storefrontAppearanceService.getPublicBanners(slug)
  } catch (err) {
    storefrontBanners.value = []
    Logger.warn('Failed to load public storefront banners', {
      error: err instanceof Error ? err.message : 'unknown_error',
      slug,
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
  } catch (err) {
    deliveryRegions.value = []
    Logger.warn('Failed to load public delivery regions', {
      error: err instanceof Error ? err.message : 'unknown_error',
    })
  } finally {
    isDeliveryRegionsLoading.value = false
  }
}

watch(
  () => [
    filters.value.search,
    filters.value.categoryId,
    filters.value.priceMin,
    filters.value.priceMax,
    filters.value.inStockOnly,
    page.value,
  ],
  () => {
    if (!isSyncingRouteState) {
      syncRouteQuery()
    }
  }
)

watch(
  () => route.query,
  (query) => {
    if (isSyncingRouteState) {
      return
    }

    const nextFilters = parseFiltersFromQuery(query)
    const nextPageValue = parsePageFromQuery(query)
    const filtersChanged = JSON.stringify(filters.value) !== JSON.stringify(nextFilters)

    if (filtersChanged) {
      updateFilters(nextFilters)
      return
    }

    if (page.value !== nextPageValue) {
      goToPage(nextPageValue)
    }
  }
)

watch(
  () => route.params?.storeSlug,
  async (storeSlug) => {
    if (typeof storeSlug === 'string' && storeSlug.trim()) {
      setSelectedStoreSlug(storeSlug)
      await Promise.allSettled([
        fetchCurrentStore(true),
        loadCategories(),
        loadDeliveryRegions(),
        loadStoreSettings(),
        loadStorefrontBanners(),
        fetchProducts(),
      ])
    }
  }
)

watch(
  publicStoreSlug,
  () => {
    void loadStorefrontBanners()
  },
)

watch(
  () => storefrontAppearance.value?.favicon_url,
  (faviconUrl) => {
    applyStorefrontFavicon(faviconUrl)
  },
  { immediate: true },
)

onMounted(async () => {
  await Promise.allSettled([
    fetchCurrentStore(),
    loadCategories(),
    loadDeliveryRegions(),
    loadStoreSettings(),
    loadStorefrontBanners(),
  ])
})

function openFilters(): void {
  draftCategoryId.value = filters.value.categoryId
  draftInStockOnly.value = filters.value.inStockOnly ?? false
  isFiltersOpen.value = true
}

function toggleFilters(): void {
  if (isFiltersOpen.value) {
    isFiltersOpen.value = false
    return
  }

  openFilters()
}

function handleQuickCategory(categoryId: number | undefined): void {
  draftCategoryId.value = categoryId
}

function handleSearchInput(event: Event): void {
  const target = event.target as HTMLInputElement
  updateFilters({ search: target.value })
}

function handleStockFilterToggle(event: Event): void {
  const target = event.target as HTMLInputElement
  draftInStockOnly.value = target.checked
}

function handleSaveFilters(): void {
  updateFilters({
    categoryId: draftCategoryId.value,
    inStockOnly: draftInStockOnly.value,
  })
  isFiltersOpen.value = false
}

function handleCancelFilters(): void {
  isFiltersOpen.value = false
}

function handleClearFilters(): void {
  clearFilters()
}

function handleGoToPage(pageNumber: number): void {
  goToPage(pageNumber)
}

function retryFetch(): void {
  void fetchProducts()
}

function handleReportCatalogProblem(): void {
  openFeedback({
    type: 'problem',
    pagePath: route.fullPath,
    correlationId: errorCorrelationId.value,
  })
}

function handleAddToCart(
  product: Product,
  quantity: number,
  variant: ProductVariant | null = null,
): void {
  if (variant) {
    addItem(product, quantity, variant)
  } else {
    addItem(product, quantity)
  }
  const variantLabel = variant?.name ? ` - ${variant.name}` : ''
  toast.success(`${quantity} unidade(s) de ${product.name}${variantLabel} adicionada(s) ao pedido.`)
}

function handleOpenDetails(product: Product): void {
  const storeSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
  const normalizedSlug = (product.slug || '').trim()
  const normalizedPublicCode = (product.public_code || '').trim()

  if (normalizedSlug) {
    void router.push({
      name: storeSlug ? PublicRoutes.StoreProductDetails : PublicRoutes.ProductDetails,
      params: storeSlug ? { storeSlug, slug: normalizedSlug } : { slug: normalizedSlug },
    })
    return
  }

  if (storeSlug && normalizedPublicCode) {
    void router.push({
      name: PublicRoutes.StoreProductByCode,
      params: { storeSlug, code: normalizedPublicCode },
    })
    return
  }

  toast.info('Nao foi possivel abrir os detalhes deste produto no momento.')
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
    await fetchProducts()
  } catch (checkoutError) {
    Logger.warn('Failed to register WhatsApp checkout', {
      error: checkoutError instanceof Error ? checkoutError.message : 'unknown_error',
    })
    const correlationId = getErrorRequestId(checkoutError)
    toast.error(extractCheckoutErrorMessage(checkoutError), undefined, {
      label: 'Relatar problema',
      onClick: () =>
        openFeedback({
          type: 'checkout',
          pagePath: route.fullPath,
          correlationId,
        }),
    })
  } finally {
    isSubmittingOrder.value = false
  }
}
</script>
