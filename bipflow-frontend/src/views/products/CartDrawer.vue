<template>
  <Transition name="cart-sheet">
    <div v-if="isOpen" class="fixed inset-0 z-50">
      <div
        class="absolute inset-0 bg-[var(--store-text)]/50"
        @click="$emit('close')"
      />

      <aside
        ref="containerRef"
        role="dialog"
        aria-modal="true"
        aria-label="Carrinho de pedido"
        class="absolute right-0 top-0 flex h-[100dvh] w-full max-w-md flex-col bg-[var(--store-bg)] shadow-[var(--shadow-sf-overlay)]"
      >
        <header class="flex items-center gap-2 border-b border-[var(--store-border)] bg-[var(--store-surface)] px-4 py-3 sm:px-6">
          <button
            v-if="step === 'details'"
            type="button"
            class="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-[var(--store-radius-sm)] px-2 text-[0.8125rem] font-medium text-[var(--store-text-muted)] transition hover:text-[var(--store-text)] focus:outline-none"
            aria-label="Voltar ao pedido"
            @click="goToReview"
          >
            <ArrowLeftIcon class="h-4 w-4" aria-hidden="true" />
            Voltar ao pedido
          </button>
          <h2
            v-else
            ref="reviewHeadingRef"
            tabindex="-1"
            class="min-w-0 flex-1 text-base font-semibold text-[var(--store-text)] focus:outline-none"
          >
            Pedido<span v-if="itemCount > 0" class="text-[var(--store-text-muted)]"> · {{ itemCount }} {{ itemCount === 1 ? 'item' : 'itens' }}</span>
          </h2>

          <button
            ref="closeButtonRef"
            type="button"
            class="storefront-icon-btn ml-auto"
            aria-label="Fechar carrinho"
            @click="$emit('close')"
          >
            <XMarkIcon class="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <!-- Empty: no steps -->
          <div v-if="items.length === 0" class="py-16 text-center">
            <ShoppingBagIcon class="mx-auto h-9 w-9 text-[var(--store-text-muted)]" aria-hidden="true" />
            <p class="mt-4 text-base font-semibold text-[var(--store-text)]">Seu pedido está vazio</p>
            <p class="mx-auto mt-2 max-w-xs text-sm leading-6 text-[var(--store-text-muted)]">
              Escolha uma peça na vitrine para iniciar o pedido.
            </p>
            <StorefrontButton variant="outline" class="mt-5" @click="$emit('close')">
              Ver catálogo
            </StorefrontButton>
          </div>

          <!-- Step 1: review the order -->
          <div v-else-if="step === 'review'">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-[0.8125rem] font-semibold text-[var(--store-text-muted)]">Itens</h3>
              <button
                type="button"
                class="min-h-9 rounded-[var(--store-radius-sm)] px-2 text-[0.8125rem] font-medium text-[var(--store-text-muted)] transition hover:text-[var(--store-brand-on-light)] focus:outline-none"
                @click="$emit('clearCart')"
              >
                Limpar
              </button>
            </div>

            <div class="divide-y divide-[var(--store-border)]">
              <article
                v-for="item in items"
                :key="getCartItemKey(item.product.id, item.variant?.id ?? null)"
                class="flex gap-3 py-3"
              >
                <img
                  :src="cartItemImage(item)"
                  :alt="`Imagem do produto ${cartItemLabel(item)}`"
                  class="h-16 w-16 shrink-0 rounded-[var(--store-radius-sm)] border border-[var(--store-border)] bg-[var(--store-image-bg,#f3f4f6)] object-cover"
                  loading="lazy"
                  decoding="async"
                />

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <h4 class="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-[var(--store-text)]">
                      {{ item.product.name }}
                    </h4>
                    <button
                      type="button"
                      class="-mr-2 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--store-radius-sm)] text-[var(--store-text-muted)] transition hover:text-[var(--store-text)] focus:outline-none"
                      :aria-label="`Remover ${cartItemLabel(item)} do pedido`"
                      @click="$emit('removeItem', item.product.id, item.variant?.id ?? null)"
                    >
                      <TrashIcon class="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-[var(--store-text-muted)]">
                    <span
                      v-if="item.variant"
                      class="inline-flex min-w-0 items-center gap-1.5"
                    >
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                        :style="{ backgroundColor: item.variant.color_hex }"
                        aria-hidden="true"
                      />
                      <span class="truncate">{{ item.variant.name }}</span>
                    </span>
                    <span>{{ formatBRL(cartItemUnitPrice(item)) }} / unidade</span>
                    <span v-if="item.variant && item.quantity >= cartItemAvailableStock(item)" class="text-[var(--store-brand-on-light)]">
                      {{ cartItemAvailableStock(item) }} disponiveis nesta cor
                    </span>
                  </p>

                  <div class="mt-2 flex items-center justify-between gap-2">
                    <div class="inline-flex h-11 items-center rounded-[var(--store-radius-sm)] border border-[var(--store-border)] bg-[var(--store-surface)]">
                      <button
                        type="button"
                        class="inline-flex h-11 w-10 items-center justify-center rounded-l-[var(--store-radius-sm)] text-[var(--store-text)] transition hover:bg-[var(--store-bg)] focus:outline-none"
                        :aria-label="`Diminuir quantidade de ${cartItemLabel(item)}`"
                        @click="$emit('updateQuantity', item.product.id, item.quantity - 1, item.variant?.id ?? null)"
                      >
                        <MinusIcon class="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span class="min-w-8 text-center text-[0.8125rem] font-semibold text-[var(--store-text)]">
                        {{ item.quantity }}
                      </span>
                      <button
                        type="button"
                        class="inline-flex h-11 w-10 items-center justify-center rounded-r-[var(--store-radius-sm)] text-[var(--store-text)] transition hover:bg-[var(--store-bg)] focus:outline-none disabled:opacity-35"
                        :aria-label="`Aumentar quantidade de ${cartItemLabel(item)}`"
                        :disabled="item.quantity >= cartItemAvailableStock(item)"
                        @click="$emit('updateQuantity', item.product.id, item.quantity + 1, item.variant?.id ?? null)"
                      >
                        <PlusIcon class="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    <p class="text-[0.9375rem] font-semibold text-[var(--store-text)]">
                      {{ formatBRL(Number(cartItemUnitPrice(item)) * item.quantity) }}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <!-- Step 2: identity, delivery and address -->
          <section v-else class="pb-2">
            <h3
              ref="detailsHeadingRef"
              tabindex="-1"
              class="text-base font-semibold text-[var(--store-text)] focus:outline-none"
            >
              Finalizar pedido
              <span class="font-normal text-[var(--store-text-muted)]">· {{ itemCount }} {{ itemCount === 1 ? 'item' : 'itens' }}</span>
            </h3>

            <!-- Compact, secondary financial summary -- Produtos/Frete moved out of
                 the footer so it stops competing with the CTA for vertical space.
                 Reuses the same reactive subtotal/deliveryFee props as the footer;
                 no local snapshot, nothing recomputed. -->
            <div class="mt-3 rounded-[var(--store-radius-sm)] bg-[var(--store-bg)] px-3 py-2.5" data-cy="checkout-summary">
              <CheckoutSummaryRow label="Produtos" :value="formatBRL(subtotal)" />
              <div v-if="freightRowState !== 'hidden'" class="mt-1">
                <CheckoutSummaryRow
                  label="Frete"
                  :value="freightRowState === 'amount' ? formatBRL(deliveryFee) : 'A calcular'"
                />
              </div>
              <p class="mt-2 text-[0.6875rem] text-[var(--store-text-muted)]">
                Valor final confirmado no WhatsApp.
              </p>
            </div>

            <div class="mt-3 grid gap-3">
              <template v-if="!hasProfileIdentity">
                <div class="grid gap-4 sm:grid-cols-2">
                  <label class="block">
                    <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                      Nome
                    </span>
                    <input
                      ref="fullNameInputRef"
                      :value="customer.fullName"
                      type="text"
                      autocomplete="name"
                      class="cart-field"
                      :class="{ 'cart-field--invalid': shouldShowError('fullName') }"
                      placeholder="Seu nome"
                      :aria-invalid="shouldShowError('fullName') ? 'true' : undefined"
                      :aria-describedby="shouldShowError('fullName') ? 'checkout-field-full-name-error' : undefined"
                      @input="handleFullNameInput"
                      @blur="markTouched('fullName')"
                    />
                    <FieldError id="checkout-field-full-name-error" :message="errorMessage('fullName')" />
                  </label>

                  <label class="block">
                    <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                      Telefone
                    </span>
                    <input
                      ref="phoneInputRef"
                      :value="customer.phone"
                      type="tel"
                      autocomplete="tel"
                      class="cart-field"
                      :class="{ 'cart-field--invalid': shouldShowError('phone') }"
                      placeholder="(11) 99999-0000"
                      :aria-invalid="shouldShowError('phone') ? 'true' : undefined"
                      :aria-describedby="shouldShowError('phone') ? 'checkout-field-phone-error' : undefined"
                      @input="handlePhoneInput"
                      @blur="markTouched('phone')"
                    />
                    <FieldError id="checkout-field-phone-error" :message="errorMessage('phone')" />
                  </label>
                </div>

                <label class="block">
                  <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                    E-mail (opcional)
                  </span>
                  <input
                    :value="customer.email"
                    type="email"
                    autocomplete="email"
                    class="cart-field"
                    placeholder="voce@exemplo.com"
                    @input="handleEmailInput"
                  />
                </label>
              </template>

              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                    Entrega
                  </span>
                  <select
                    :value="customer.deliveryMethod"
                    class="cart-field"
                    @change="handleDeliveryMethodChange"
                  >
                    <option value="delivery">Receber em casa</option>
                    <option value="pickup">Retirar na loja</option>
                  </select>
                </label>

                <label class="block">
                  <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                    Pagamento
                  </span>
                  <select
                    :value="customer.paymentMethod"
                    class="cart-field"
                    @change="handlePaymentMethodChange"
                  >
                    <option value="pix">Pix</option>
                    <option value="card">Cartao</option>
                    <option value="cash">Dinheiro</option>
                  </select>
                </label>
              </div>

              <template v-if="customer.deliveryMethod === 'delivery'">
                <label class="block">
                  <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                    Regiao de entrega
                  </span>
                  <select
                    ref="deliveryRegionSelectRef"
                    data-cy="checkout-field-delivery-region"
                    :value="customer.deliveryRegionId ?? ''"
                    class="cart-field"
                    :class="{ 'cart-field--invalid': shouldShowError('deliveryRegionId') }"
                    :disabled="isDeliveryRegionsLoading || deliveryRegions.length === 0"
                    :aria-invalid="shouldShowError('deliveryRegionId') ? 'true' : undefined"
                    :aria-describedby="shouldShowError('deliveryRegionId') ? 'checkout-field-delivery-region-error' : undefined"
                    @change="handleDeliveryRegionChange"
                    @blur="markTouched('deliveryRegionId')"
                  >
                    <option value="">
                      {{ deliveryRegionPlaceholder }}
                    </option>
                    <option
                      v-for="region in deliveryRegions"
                      :key="region.id"
                      :value="region.id"
                    >
                      {{ region.name }} - {{ formatBRL(region.delivery_fee) }}
                    </option>
                  </select>
                  <FieldError id="checkout-field-delivery-region-error" :message="errorMessage('deliveryRegionId')" />
                </label>

                <div
                  v-if="hasCompleteProfileAddress"
                  class="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs leading-5 text-emerald-900"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="font-bold">Endereço salvo</p>
                      <p class="mt-1 text-emerald-800">{{ profileAddressSummary }}</p>
                    </div>
                    <RouterLink :to="accountRoute" class="shrink-0 font-semibold text-[var(--store-primary)] hover:underline">
                      Editar
                    </RouterLink>
                  </div>
                </div>

                <template v-else>
                  <p
                    v-if="shouldSaveCheckoutAddress"
                    class="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs leading-5 text-sky-900"
                  >
                    Informe o endereço desta entrega. Ele será salvo no seu perfil para os próximos pedidos.
                  </p>

                  <label class="block">
                    <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                      Endereço
                    </span>
                    <input
                      ref="addressInputRef"
                      :value="customer.address"
                      type="text"
                      autocomplete="street-address"
                      class="cart-field"
                      :class="{ 'cart-field--invalid': shouldShowError('address') }"
                      placeholder="Rua, numero e complemento"
                      :aria-invalid="shouldShowError('address') ? 'true' : undefined"
                      :aria-describedby="shouldShowError('address') ? 'checkout-field-address-error' : undefined"
                      @input="handleAddressInput"
                      @blur="markTouched('address')"
                    />
                    <FieldError id="checkout-field-address-error" :message="errorMessage('address')" />
                  </label>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <label class="block">
                      <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                        Bairro
                      </span>
                      <input
                        ref="neighborhoodInputRef"
                        :value="customer.neighborhood"
                        type="text"
                        autocomplete="address-level3"
                        class="cart-field"
                        :class="{ 'cart-field--invalid': shouldShowError('neighborhood') }"
                        placeholder="Bairro"
                        :aria-invalid="shouldShowError('neighborhood') ? 'true' : undefined"
                        :aria-describedby="shouldShowError('neighborhood') ? 'checkout-field-neighborhood-error' : undefined"
                        @input="handleNeighborhoodInput"
                        @blur="markTouched('neighborhood')"
                      />
                      <FieldError id="checkout-field-neighborhood-error" :message="errorMessage('neighborhood')" />
                    </label>

                    <label class="block">
                      <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                        Cidade
                      </span>
                      <input
                        ref="cityInputRef"
                        :value="customer.city"
                        type="text"
                        autocomplete="address-level2"
                        class="cart-field"
                        :class="{ 'cart-field--invalid': shouldShowError('city') }"
                        placeholder="Cidade"
                        :aria-invalid="shouldShowError('city') ? 'true' : undefined"
                        :aria-describedby="shouldShowError('city') ? 'checkout-field-city-error' : undefined"
                        @input="handleCityInput"
                        @blur="markTouched('city')"
                      />
                      <FieldError id="checkout-field-city-error" :message="errorMessage('city')" />
                    </label>
                  </div>
                </template>
              </template>

              <label class="block">
                <span class="mb-1 block text-[0.8125rem] font-medium text-[var(--store-text-muted)]">
                  Observacoes
                </span>
                <textarea
                  :value="customer.notes"
                  rows="3"
                  class="cart-field cart-field--area"
                  placeholder="Tamanho, referencia ou combinados do pedido"
                  @input="handleNotesInput"
                />
              </label>
            </div>
          </section>
        </div>

        <footer
          v-if="items.length > 0"
          class="border-t border-[var(--store-border)] bg-[var(--store-surface)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6"
        >
          <!-- Step 1: full financial recap (Produtos/Frete/Total) + Continuar. -->
          <template v-if="step === 'review'">
            <div class="text-[0.8125rem]">
              <div class="flex items-center justify-between text-[var(--store-text-muted)]">
                <span>Produtos</span>
                <span>{{ formatBRL(subtotal) }}</span>
              </div>
              <div
                v-if="customer.deliveryMethod === 'delivery' && deliveryFee > 0"
                class="mt-1 flex items-center justify-between text-[var(--store-text-muted)]"
              >
                <span>Frete</span>
                <span>{{ formatBRL(deliveryFee) }}</span>
              </div>
              <div class="mt-2 flex items-baseline justify-between text-[var(--store-text)]">
                <span class="text-sm font-semibold">Total</span>
                <span class="text-lg font-semibold">{{ formatBRL(total) }}</span>
              </div>
            </div>

            <p
              v-if="footerMessage"
              class="mt-2 text-[0.75rem] font-medium"
              :class="isWhatsAppConfigured ? 'text-[var(--store-text-muted)]' : 'text-[#B45309]'"
            >
              {{ footerMessage }}
            </p>

            <StorefrontButton
              data-cy="checkout-continue-button"
              size="lg"
              block
              class="mt-3"
              :disabled="!canContinue"
              @click="goToDetails"
            >
              Continuar
            </StorefrontButton>
          </template>

          <!-- Step 2: Total only + CTA -- the rest of the summary lives in the
               body now (see .cart-summary above the form). -->
          <template v-else>
            <CheckoutSummaryRow label="Total" :value="formatBRL(total)" emphasis />

            <p
              v-if="footerMessage"
              class="mt-2 text-[0.75rem] font-medium"
              :class="isWhatsAppConfigured ? 'text-[var(--store-text-muted)]' : 'text-[#B45309]'"
            >
              {{ footerMessage }}
            </p>
            <p
              v-if="showAttemptBanner"
              :key="attemptCount"
              role="alert"
              class="mt-2 text-[0.75rem] font-medium text-[var(--color-danger)]"
            >
              Revise os campos destacados.
            </p>

            <StorefrontButton
              data-cy="checkout-submit-button"
              size="md"
              block
              class="mt-3"
              :loading="isSubmitting"
              :disabled="isStructurallyBlocked"
              @click="handleSubmitClick"
            >
              <ChatBubbleBottomCenterTextIcon class="h-5 w-5 shrink-0" aria-hidden="true" />
              {{ submitButtonLabel }}
            </StorefrontButton>
          </template>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  ArrowLeftIcon,
  ChatBubbleBottomCenterTextIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import CheckoutSummaryRow from '@/components/storefront/CheckoutSummaryRow.vue'
import FieldError from '@/components/storefront/FieldError.vue'
import StorefrontButton from '@/components/storefront/StorefrontButton.vue'
import { customerAccountPath } from '@/router/auth.routes'
import type { CustomerProfile } from '@/types/customer'
import type { DeliveryRegion } from '@/types/delivery'
import type { CartCustomer, CartItem } from '@/types/product'
import { formatBRL } from '@/utils/formatters'
import { effectiveUnitPrice } from '@/utils/pricing'
import { findFirstInvalidField, focusAndRevealField, type FocusableFormField } from '@/utils/formFieldFocus'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useStorefrontOverlay } from '@/composables/useStorefrontOverlay'
import { getCartItemKey } from '@/composables/useCart'

const fallbackImageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
    <rect width="240" height="240" fill="#FAFAFA" />
    <rect x="28" y="28" width="184" height="184" rx="22" fill="#FFFFFF" stroke="#E5E7EB" />
    <rect x="64" y="68" width="112" height="76" rx="14" fill="#F3F4F6" />
    <path d="M76 132l26-27c5-5 13-5 18 0l17 18 9-10c5-5 14-5 19 0l29 30v14H76z" fill="#D1D5DB" />
    <text x="120" y="184" text-anchor="middle" fill="var(--store-text-muted)" font-family="Arial, sans-serif" font-size="15" font-weight="700">Imagem em breve</text>
  </svg>
`)}`

const props = withDefaults(defineProps<{
  isOpen: boolean
  items: CartItem[]
  itemCount: number
  subtotal: number
  deliveryFee: number
  total: number
  customer: CartCustomer
  deliveryRegions: DeliveryRegion[]
  isDeliveryRegionsLoading?: boolean
  isSubmitting?: boolean
  isWhatsAppConfigured: boolean
  profile: CustomerProfile | null
}>(), {
  isDeliveryRegionsLoading: false,
  isSubmitting: false,
})

const emit = defineEmits<{
  close: []
  clearCart: []
  removeItem: [productId: number, variantId?: number | null]
  updateQuantity: [productId: number, quantity: number, variantId?: number | null]
  updateCustomer: [patch: Partial<CartCustomer>]
  submitOrder: []
}>()

const containerRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const reviewHeadingRef = ref<HTMLElement | null>(null)
const detailsHeadingRef = ref<HTMLElement | null>(null)

useDialogA11y(toRef(props, 'isOpen'), () => emit('close'), containerRef, closeButtonRef)
useStorefrontOverlay(toRef(props, 'isOpen'))

// Two-step checkout: 'review' the order, then 'details' (identity/delivery/
// address). Customer data lives in the parent, so moving between steps never
// loses input. The submit contract is unchanged -- the parent still owns the
// payload and only reacts to `submitOrder`.
type CheckoutStep = 'review' | 'details'
const step = ref<CheckoutStep>('review')

// Takes a getter, not a resolved element: the destination step's heading
// isn't in the DOM yet at the call site below (it only renders once Vue
// processes the `step` change), so its ref is still null until then --
// reading `.value` has to happen inside the nextTick callback, after the
// patch, not before it.
function moveFocus(getTarget: () => HTMLElement | null): void {
  void nextTick(() => getTarget()?.focus())
}

function goToDetails(): void {
  if (!canContinue.value) return
  step.value = 'details'
  moveFocus(() => detailsHeadingRef.value)
}

function goToReview(): void {
  step.value = 'review'
  moveFocus(() => reviewHeadingRef.value)
}

// Reset to 'review' whenever the drawer (re)opens or the cart empties -- but
// never mid-session (a transient submit failure keeps the shopper on 'details'
// with their data intact). A fresh session also clears the Ciclo 8 validation
// UI state (touched fields / attempted-submit banner) so a *new* order never
// opens with stale red fields; going back and forth between the two steps of
// the *same* session intentionally leaves that state alone.
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      step.value = 'review'
      resetValidationState()
    }
  },
)
watch(
  () => props.items.length,
  (count) => {
    if (count === 0) {
      step.value = 'review'
      resetValidationState()
    }
  },
)

const route = useRoute()
const accountRoute = computed(() => {
  const storeSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
  return { path: customerAccountPath(storeSlug) }
})

// Guest checkout reinstated: identity always comes from a resolved profile
// when one exists (hide the name/phone/email inputs entirely); address
// specifically falls back to the guest inputs whenever the profile's own
// address is incomplete, independent of identity -- mirrors the backend's
// exact precedence in CheckoutWhatsAppView.post().
const hasProfileIdentity = computed(() => props.profile !== null)
const hasCompleteProfileAddress = computed(() => (
  !!props.profile?.address?.trim()
  && !!props.profile?.neighborhood?.trim()
  && !!props.profile?.city?.trim()
))

const shouldSaveCheckoutAddress = computed(() => (
  props.customer.deliveryMethod === 'delivery'
  && hasProfileIdentity.value
  && !hasCompleteProfileAddress.value
))

const profileAddressSummary = computed(() => (
  [
    props.profile?.address,
    props.profile?.neighborhood,
    props.profile?.city,
  ]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join(' - ')
))

const deliveryRegionPlaceholder = computed(() => {
  if (props.isDeliveryRegionsLoading) {
    return 'Carregando regioes...'
  }

  return props.deliveryRegions.length > 0
    ? 'Selecione uma regiao'
    : 'Combinar entrega com a loja'
})

const stockLimitedItemLabel = computed(() => {
  const item = props.items.find((entry) => entry.quantity > cartItemAvailableStock(entry))
  return item ? cartItemLabel(item) : ''
})

// --- Ciclo 8.1: single source of truth for checkout validity ---
//
// `checkoutIssues` is the *only* place that inspects `props.customer` /
// `props.items` / `props.isWhatsAppConfigured` to decide what's wrong with
// the order as it stands. Everything else in this file -- the aggregated
// message, the per-field errors, the submit-button gate, and "which field to
// focus first" -- is *derived* by filtering/reducing this one list. Nothing
// re-checks a condition that already lives here, so there is exactly one
// place to change if a requirement ever changes.
//
// `kind: 'structural'` means nothing the shopper can type their way out of
// on this step (empty cart, stock, no WhatsApp) -- only these may disable
// the submit button. `kind: 'field'` carries the `field` key a form control
// maps to, and only ever appears while that field is actually rendered
// (identity fields require a guest checkout; address fields require
// delivery + no complete saved address; the region field requires delivery
// + at least one configured region) -- a hidden field can therefore never
// produce an issue.
type FieldKey = 'fullName' | 'phone' | 'deliveryRegionId' | 'address' | 'neighborhood' | 'city'

interface ValidationIssue {
  kind: 'structural' | 'field'
  field?: FieldKey
  message: string
}

const isGuestIdentity = computed(() => !hasProfileIdentity.value)
const isDeliverySelected = computed(() => props.customer.deliveryMethod === 'delivery')
const needsGuestAddress = computed(() => isDeliverySelected.value && !hasCompleteProfileAddress.value)
const needsDeliveryRegion = computed(() => isDeliverySelected.value && props.deliveryRegions.length > 0)

const checkoutIssues = computed<ValidationIssue[]>(() => {
  const issues: ValidationIssue[] = []

  if (props.itemCount === 0) {
    issues.push({ kind: 'structural', message: 'Adicione ao menos um item ao pedido.' })
    return issues // nothing else about the order matters with an empty cart
  }

  if (stockLimitedItemLabel.value) {
    issues.push({
      kind: 'structural',
      message: `Ajuste a quantidade de ${stockLimitedItemLabel.value} ao estoque disponível.`,
    })
  }

  if (!props.isWhatsAppConfigured) {
    issues.push({ kind: 'structural', message: 'WhatsApp da loja ainda não configurado.' })
  }

  if (isGuestIdentity.value) {
    if (!props.customer.fullName.trim()) {
      issues.push({ kind: 'field', field: 'fullName', message: 'Informe seu nome.' })
    }
    if (!props.customer.phone.trim()) {
      // The existing rule only checks for a non-empty value (no format/length
      // check exists anywhere in this flow), so the message says exactly
      // that -- not "informe um telefone valido", which would imply a rule
      // that isn't actually enforced.
      issues.push({ kind: 'field', field: 'phone', message: 'Informe seu telefone.' })
    }
  }

  if (needsDeliveryRegion.value && !props.customer.deliveryRegionId) {
    issues.push({ kind: 'field', field: 'deliveryRegionId', message: 'Selecione a região de entrega.' })
  }

  if (needsGuestAddress.value) {
    if (!props.customer.address.trim()) {
      issues.push({ kind: 'field', field: 'address', message: 'Informe o endereço.' })
    }
    if (!props.customer.neighborhood.trim()) {
      issues.push({ kind: 'field', field: 'neighborhood', message: 'Informe o bairro.' })
    }
    if (!props.customer.city.trim()) {
      issues.push({ kind: 'field', field: 'city', message: 'Informe a cidade.' })
    }
  }

  return issues
})

// Aggregated message, derived: the first issue in priority order, or empty
// when the order is valid. Nothing renders this string directly anymore
// (each field/structural note has its own spot), but it remains the single
// boolean-ish gate handleSubmitClick uses to decide whether to emit
// `submitOrder` -- unchanged in meaning from the Ciclo 7 `checkoutValidationMessage`.
const checkoutValidationMessage = computed(() => checkoutIssues.value[0]?.message ?? '')

// Only a *structural* issue (plus an in-flight submission) may disable the
// final button -- a corrigible-only state must stay clickable so the click
// can reveal the per-field errors and move focus (see handleSubmitClick).
const isStructurallyBlocked = computed(() => (
  props.isSubmitting || checkoutIssues.value.some((issue) => issue.kind === 'structural')
))

// Step 1 -> Step 2 only needs a valid *order* (items present, none over
// stock) and a store that can actually receive it. Personal data is Step 2's
// job and only gates the final submit. Unchanged from Ciclo 7.
const canContinue = computed(() => (
  props.itemCount > 0
  && props.isWhatsAppConfigured
  && !stockLimitedItemLabel.value
))

// One message slot in the footer, appropriate to the current step. In
// 'details' this now only ever carries a *structural* note (WhatsApp
// missing / stock, both already unreachable in practice once canContinue
// gated the step change, but kept for defensive symmetry) -- corrigible
// field issues are surfaced per-field plus the discreet banner below, not
// duplicated here.
const footerMessage = computed(() => {
  if (!props.isWhatsAppConfigured) {
    return 'WhatsApp da loja ainda não configurado.'
  }
  return stockLimitedItemLabel.value
    ? `Ajuste a quantidade de ${stockLimitedItemLabel.value} ao estoque disponível.`
    : ''
})

const submitButtonLabel = computed(() => {
  if (props.isSubmitting) {
    return 'Registrando pedido...'
  }

  return props.isWhatsAppConfigured ? 'Finalizar pedido' : 'WhatsApp indisponível'
})

// "Frete ainda não calculado": delivery is selected, a region can be picked,
// but none has been yet -- distinct from pickup (no freight row at all) and
// from a resolved fee. Reuses the exact same reactive props the footer
// already used; nothing here is computed or cached locally.
const freightRowState = computed<'hidden' | 'amount' | 'pending'>(() => {
  if (!isDeliverySelected.value) return 'hidden'
  if (props.deliveryFee > 0) return 'amount'
  if (!props.customer.deliveryRegionId && props.deliveryRegions.length > 0) return 'pending'
  return 'hidden'
})

// --- Ciclo 8: per-field presentation over `checkoutIssues` (see above) ---

const fullNameInputRef = ref<HTMLElement | null>(null)
const phoneInputRef = ref<HTMLElement | null>(null)
const deliveryRegionSelectRef = ref<HTMLElement | null>(null)
const addressInputRef = ref<HTMLElement | null>(null)
const neighborhoodInputRef = ref<HTMLElement | null>(null)
const cityInputRef = ref<HTMLElement | null>(null)

const FIELD_REFS: Record<FieldKey, typeof fullNameInputRef> = {
  fullName: fullNameInputRef,
  phone: phoneInputRef,
  deliveryRegionId: deliveryRegionSelectRef,
  address: addressInputRef,
  neighborhood: neighborhoodInputRef,
  city: cityInputRef,
}

const touchedFields = reactive<Partial<Record<FieldKey, boolean>>>({})
const attemptedSubmit = ref(false)
const attemptCount = ref(0)

function markTouched(field: FieldKey): void {
  touchedFields[field] = true
}

function resetValidationState(): void {
  attemptedSubmit.value = false
  attemptCount.value = 0
  for (const key of Object.keys(touchedFields) as FieldKey[]) {
    delete touchedFields[key]
  }
}

// Every per-field question below (is there an error? what does it say? is
// there *any* corrigible error? which field should get focus?) is answered
// by looking up `checkoutIssues` -- never by re-evaluating a condition.
function fieldIssue(field: FieldKey): ValidationIssue | undefined {
  return checkoutIssues.value.find((issue) => issue.field === field)
}

function shouldShowError(field: FieldKey): boolean {
  return Boolean(fieldIssue(field)) && (touchedFields[field] === true || attemptedSubmit.value)
}

function errorMessage(field: FieldKey): string {
  return shouldShowError(field) ? (fieldIssue(field)?.message ?? '') : ''
}

const hasAnyCorrigibleFieldError = computed(() => (
  checkoutIssues.value.some((issue) => issue.kind === 'field')
))

const showAttemptBanner = computed(() => attemptedSubmit.value && hasAnyCorrigibleFieldError.value)

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

async function handleSubmitClick(): Promise<void> {
  if (isStructurallyBlocked.value) {
    return
  }

  attemptedSubmit.value = true

  if (checkoutValidationMessage.value) {
    // A corrigible field is still invalid: block the submission, reveal
    // every applicable error and move focus to the first one -- never emit
    // submitOrder for an order the backend would reject anyway. The
    // candidate list -- and therefore focus order -- comes straight from
    // checkoutIssues, in the same priority order it already pushes fields in
    // (which matches the form's visual top-to-bottom order).
    attemptCount.value += 1
    await nextTick()

    const candidates: FocusableFormField[] = checkoutIssues.value
      .filter((issue) => issue.kind === 'field' && issue.field !== undefined)
      .map((issue) => ({
        key: issue.field as FieldKey,
        applicable: true,
        invalid: true,
        element: FIELD_REFS[issue.field as FieldKey].value,
      }))
    const firstInvalid = findFirstInvalidField(candidates)
    if (firstInvalid?.element) {
      focusAndRevealField(firstInvalid.element, { reduceMotion: prefersReducedMotion.value })
    }
    return
  }

  emit('submitOrder')
}

function cartItemImage(item: CartItem): string {
  return item.variant?.image || item.product.image || fallbackImageUrl
}

function cartItemLabel(item: CartItem): string {
  return item.variant?.name
    ? `${item.product.name} - ${item.variant.name}`
    : item.product.name
}

// Display only -- the backend recomputes every line from product_id /
// variant_id / quantity at checkout (see product-variant-pricing.md).
function cartItemUnitPrice(item: CartItem): string {
  return effectiveUnitPrice(item.product, item.variant)
}

function cartItemAvailableStock(item: CartItem): number {
  const productStock = Math.max(0, Math.trunc(Number(item.product.stock_quantity) || 0))
  const variantStock = item.variant
    ? Math.max(0, Math.trunc(Number(item.variant.stock_quantity) || 0))
    : productStock

  return Math.min(productStock, variantStock)
}

function getInputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

function handleNotesInput(event: Event): void {
  emit('updateCustomer', {
    notes: getInputValue(event),
  })
}

function handleFullNameInput(event: Event): void {
  emit('updateCustomer', { fullName: getInputValue(event) })
}

function handlePhoneInput(event: Event): void {
  emit('updateCustomer', { phone: getInputValue(event) })
}

function handleEmailInput(event: Event): void {
  emit('updateCustomer', { email: getInputValue(event) })
}

function handleAddressInput(event: Event): void {
  emit('updateCustomer', { address: getInputValue(event) })
}

function handleNeighborhoodInput(event: Event): void {
  emit('updateCustomer', { neighborhood: getInputValue(event) })
}

function handleCityInput(event: Event): void {
  emit('updateCustomer', { city: getInputValue(event) })
}

function handleDeliveryMethodChange(event: Event): void {
  const deliveryMethod = getInputValue(event) as CartCustomer['deliveryMethod']

  emit('updateCustomer', {
    deliveryMethod,
    ...(deliveryMethod === 'pickup'
      ? {
          deliveryRegionId: null,
          deliveryRegionName: '',
          deliveryRegionFee: 0,
        }
      : {}),
  })
}

function handlePaymentMethodChange(event: Event): void {
  emit('updateCustomer', {
    paymentMethod: getInputValue(event) as CartCustomer['paymentMethod'],
  })
}

function handleDeliveryRegionChange(event: Event): void {
  const regionId = Number(getInputValue(event))
  const region = props.deliveryRegions.find((item) => item.id === regionId)

  emit('updateCustomer', {
    deliveryRegionId: region?.id ?? null,
    deliveryRegionName: region?.name ?? '',
    deliveryRegionFee: region ? Number(region.delivery_fee) : 0,
  })
}
</script>

<style scoped>
/* Shared storefront field styling for the checkout inputs/selects: 16px text
   (no mobile auto-zoom), token colours, consistent focus ring. */
.cart-field {
  width: 100%;
  min-height: 2.75rem;
  border-radius: var(--store-radius-sm);
  border: 1px solid var(--store-border);
  background: var(--store-surface);
  padding-inline: 0.875rem;
  font-size: 16px;
  line-height: 1.5;
  color: var(--store-text);
  outline: none;
  scroll-margin-block: 5rem;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.cart-field::placeholder {
  color: var(--store-text-muted);
}

.cart-field:focus {
  border-color: var(--store-focus);
  box-shadow: 0 0 0 3px var(--store-brand-soft);
}

.cart-field:focus-visible {
  outline: 2px solid var(--store-focus);
  outline-offset: 2px;
}

.cart-field:disabled {
  background: var(--store-bg);
  color: var(--store-text-muted);
}

.cart-field--area {
  min-height: 4.5rem;
  padding-block: 0.625rem;
  resize: none;
}

/* Ciclo 8: field-level invalid state -- border color changes, but the icon +
   text in FieldError.vue (and aria-invalid) carry the meaning, not color alone. */
.cart-field--invalid {
  border-color: var(--color-danger);
}

.cart-field--invalid:focus {
  border-color: var(--color-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-danger) 18%, transparent);
}

.cart-sheet-enter-active,
.cart-sheet-leave-active {
  transition: opacity 0.22s ease;
}

.cart-sheet-enter-active aside,
.cart-sheet-leave-active aside {
  transition: transform 0.26s ease;
}

.cart-sheet-enter-from,
.cart-sheet-leave-to {
  opacity: 0;
}

.cart-sheet-enter-from aside,
.cart-sheet-leave-to aside {
  transform: translateX(100%);
}
</style>
