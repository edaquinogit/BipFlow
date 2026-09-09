<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { ChatBubbleLeftRightIcon, TruckIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import type { PaymentStatus, SaleOrderDetail } from '@/types/sales';
import {
  getChannelLabel,
  getDeliveryMethodLabel,
  getPaymentActionLabel,
  getPaymentLabel,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  getSaleStatusLabel,
} from '@/constants/saleOrder';
import { formatBRL, formatDateTimeBR } from '@/utils/formatters';
import { useDialogA11y } from '@/composables/useDialogA11y';

/**
 * Etapa 0 of the pedidos/NF/envio evolution (see
 * docs/architecture/pedidos-nf-envio-evolution.md): until now there was no
 * way to see a full order -- address, customer notes, or the original
 * WhatsApp message -- anywhere in the dashboard.
 *
 * Etapa 1: status-changing actions (marcar como enviado/entregue/cancelar)
 * moved here from the loose <select> the order card used to have. Mutations
 * themselves stay owned by DashboardOrdersView.vue (isUpdating/updateError
 * props, ship/deliver/cancel emits) -- this component only owns the ship
 * form's own draft state.
 */
const props = defineProps<{
  show: boolean;
  order: SaleOrderDetail | null;
  isLoading: boolean;
  error: string | null;
  canManage: boolean;
  isUpdating: boolean;
  updateError: string | null;
}>();

const emit = defineEmits<{
  close: [];
  ship: [{ carrierName: string; trackingCode: string }];
  deliver: [];
  cancel: [];
  // Online-sales foundation: record what happened to the payment. `target`
  // is one of order.available_payment_actions.
  payment: [{ target: PaymentStatus }];
}>();

const containerRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);

useDialogA11y(toRef(props, 'show'), () => emit('close'), containerRef, closeButtonRef);

const isShipFormOpen = ref(false);
const carrierNameDraft = ref('');
const trackingCodeDraft = ref('');
const shipFormValidationError = ref<string | null>(null);

// Reset the ship form every time the modal opens (for this order or a
// different one) so a previous attempt's draft/error never leaks in.
watch(() => props.show, (show) => {
  if (show) {
    isShipFormOpen.value = false;
    carrierNameDraft.value = '';
    trackingCodeDraft.value = '';
    shipFormValidationError.value = null;
  }
});

// Closes the ship form once the mutation actually lands (order.status
// flips away from "prepared"); a failed attempt leaves status unchanged,
// so the form -- and the operator's already-typed carrier/tracking --
// stays put and shows props.updateError instead.
watch(() => props.order?.status, (newStatus, oldStatus) => {
  if (newStatus !== oldStatus) {
    isShipFormOpen.value = false;
  }
});

const canMarkShipped = computed(() => (
  props.order?.status === 'prepared' && props.order.delivery_method === 'delivery'
));
const canMarkDelivered = computed(() => (
  props.order?.status === 'sent'
  || (props.order?.status === 'prepared' && props.order.delivery_method === 'pickup')
));
const canCancel = computed(() => (
  props.order?.status === 'prepared' || props.order?.status === 'sent'
));

// Online-sales foundation: the operator's payment actions come straight
// from the backend (`available_payment_actions`), so a status that has no
// legal manual move simply shows no buttons.
const paymentActions = computed<PaymentStatus[]>(() => props.order?.available_payment_actions ?? []);
const isRefundPending = computed(
  () => props.order?.payment_status === 'refund_pending',
);
const paymentReference = computed(() => props.order?.payment_reference?.trim() ?? '');

// Etapa 1: "Notificar cliente" reuses the wa.me pattern already used by the
// public checkout (order.service.ts's buildWhatsAppHandoffUrl), but in the
// other direction -- the operator messaging the customer's own phone, not
// the store's.
const notifyCustomerUrl = computed(() => {
  const order = props.order;
  if (!order || !order.carrier_name || !order.tracking_code) {
    return null;
  }

  const normalizedPhone = order.customer_phone.replace(/\D/g, '');
  if (!normalizedPhone) {
    return null;
  }

  const messageLines = [
    `Seu pedido ${order.order_reference} foi enviado!`,
    `Transportadora: ${order.carrier_name}`,
    `Codigo de rastreio: ${order.tracking_code}`,
  ];
  if (order.tracking_url) {
    messageLines.push(`Rastreie aqui: ${order.tracking_url}`);
  }

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(messageLines.join('\n'))}`;
});

function openShipForm(): void {
  isShipFormOpen.value = true;
  shipFormValidationError.value = null;
}

function closeShipForm(): void {
  isShipFormOpen.value = false;
  shipFormValidationError.value = null;
}

function submitShipForm(): void {
  const carrierName = carrierNameDraft.value.trim();
  const trackingCode = trackingCodeDraft.value.trim();

  if (!carrierName || !trackingCode) {
    shipFormValidationError.value = 'Informe a transportadora e o codigo de rastreio.';
    return;
  }

  shipFormValidationError.value = null;
  emit('ship', { carrierName, trackingCode });
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="modal-overlay">
        <div
          ref="containerRef"
          class="modal-container"
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes do pedido"
        >
          <button
            ref="closeButtonRef"
            type="button"
            aria-label="Fechar"
            class="close-button"
            @click="emit('close')"
          >
            <XMarkIcon class="h-4 w-4" />
          </button>

          <div v-if="isLoading" class="space-y-3 py-6">
            <div class="h-4 w-40 animate-pulse rounded bg-zinc-100" />
            <div class="h-3 w-64 animate-pulse rounded bg-zinc-100" />
            <div class="h-24 w-full animate-pulse rounded bg-zinc-100" />
          </div>

          <div v-else-if="error" class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-4 text-sm text-[#374151]">
            {{ error }}
          </div>

          <div v-else-if="order" class="max-h-[75vh] space-y-6 overflow-y-auto pr-1">
            <div>
              <p class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">
                Pedido {{ order.order_reference }}
              </p>
              <h3 class="mt-1 text-xl font-black italic tracking-tighter text-[#05050A]">
                {{ order.customer_name }}
              </h3>
              <div class="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                <span class="rounded-full border border-[#E5E7EB] bg-zinc-50 px-2.5 py-1 text-bip-muted">
                  {{ getSaleStatusLabel(order.status) }}
                </span>
                <span
                  class="rounded-full border px-2.5 py-1"
                  :class="getPaymentStatusBadgeClass(order.payment_status)"
                  data-cy="order-detail-payment-badge"
                >
                  {{ getPaymentStatusLabel(order.payment_status) }}
                </span>
                <span class="rounded-full border border-[#E5E7EB] bg-zinc-50 px-2.5 py-1 text-bip-muted">
                  {{ getChannelLabel(order.channel) }}
                </span>
              </div>
              <p class="mt-2 text-xs text-bip-muted">{{ formatDateTimeBR(order.created_at) }}</p>
            </div>

            <section class="space-y-1.5">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">Cliente</h4>
              <p class="text-sm text-[#05050A]">{{ order.customer_phone }}</p>
              <p v-if="order.customer_email" class="text-sm text-[#05050A]">{{ order.customer_email }}</p>
            </section>

            <section class="space-y-1.5">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">
                {{ getDeliveryMethodLabel(order.delivery_method) }}
              </h4>
              <template v-if="order.delivery_method === 'delivery'">
                <p v-if="order.address" class="text-sm text-[#05050A]">
                  {{ order.address }}<span v-if="order.neighborhood">, {{ order.neighborhood }}</span>
                </p>
                <p v-if="order.city" class="text-sm text-[#05050A]">{{ order.city }}</p>
                <p v-if="order.delivery_region_name" class="text-xs text-bip-muted">
                  Regiao: {{ order.delivery_region_name }}
                </p>
                <p v-if="!order.address" class="text-xs text-bip-muted">Endereco nao informado.</p>
              </template>
            </section>

            <section v-if="order.notes" class="space-y-1.5">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">
                Observacoes do cliente
              </h4>
              <p class="whitespace-pre-line text-sm text-[#05050A]">{{ order.notes }}</p>
            </section>

            <section v-if="order.carrier_name || order.tracking_code" class="space-y-1.5">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">Envio</h4>
              <p class="text-sm text-[#05050A]">{{ order.carrier_name }} - {{ order.tracking_code }}</p>
              <p v-if="order.shipped_at" class="text-xs text-bip-muted">
                Enviado em {{ formatDateTimeBR(order.shipped_at) }}
              </p>
              <p v-if="order.delivered_at" class="text-xs text-bip-muted">
                Entregue em {{ formatDateTimeBR(order.delivered_at) }}
              </p>
              <a
                v-if="order.tracking_url"
                :href="order.tracking_url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 text-xs font-bold text-[#111827] hover:underline"
              >
                <TruckIcon class="h-3.5 w-3.5" />
                Rastrear encomenda
              </a>
              <a
                v-if="notifyCustomerUrl"
                :href="notifyCustomerUrl"
                target="_blank"
                rel="noopener noreferrer"
                data-cy="notify-customer-link"
                class="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-emerald-800 transition hover:bg-emerald-100"
              >
                <ChatBubbleLeftRightIcon class="h-4 w-4" />
                Notificar cliente
              </a>
            </section>

            <section class="space-y-1.5">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">Itens</h4>
              <ul class="divide-y divide-[#E5E7EB] rounded-lg border border-[#E5E7EB]">
                <li
                  v-for="item in order.items"
                  :key="item.id"
                  class="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span class="min-w-0 truncate text-[#05050A]">{{ item.quantity }}x {{ item.product_name }}</span>
                  <span class="shrink-0 font-mono text-[#05050A]">{{ formatBRL(item.line_total) }}</span>
                </li>
              </ul>
              <div class="flex items-center justify-between px-1 pt-1 text-sm font-black text-[#05050A]">
                <span>Total</span>
                <span class="font-mono">{{ formatBRL(order.total) }}</span>
              </div>
            </section>

            <section class="space-y-2 border-t border-[#E5E7EB] pt-4" data-cy="order-detail-payment">
              <h4 class="text-[10px] font-black uppercase tracking-[0.3em] text-bip-muted">Pagamento</h4>

              <div class="flex flex-wrap items-center gap-2 text-sm text-[#05050A]">
                <span
                  class="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
                  :class="getPaymentStatusBadgeClass(order.payment_status)"
                >
                  {{ getPaymentStatusLabel(order.payment_status) }}
                </span>
                <span class="text-bip-muted">{{ getPaymentLabel(order.payment_method) }}</span>
              </div>

              <p v-if="order.paid_at" class="text-xs text-bip-muted">
                Pago em {{ formatDateTimeBR(order.paid_at) }}
              </p>
              <p v-if="order.refunded_at" class="text-xs text-bip-muted">
                Reembolso confirmado em {{ formatDateTimeBR(order.refunded_at) }}
              </p>
              <p v-if="paymentReference" class="text-xs text-bip-muted">
                Referência: {{ paymentReference }}
              </p>

              <p
                v-if="isRefundPending"
                class="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800"
                data-cy="order-detail-refund-warning"
                role="alert"
              >
                Reembolso pendente. O Bip Flow não processa reembolsos — devolva o
                valor pelo seu meio de pagamento<template v-if="canManage && paymentActions.length > 0">
                  e confirme abaixo</template>.
              </p>

              <div
                v-if="canManage && paymentActions.length > 0"
                class="flex flex-wrap gap-2 pt-1"
                data-cy="order-detail-payment-actions"
              >
                <button
                  v-for="target in paymentActions"
                  :key="target"
                  type="button"
                  :data-cy="`payment-action-${target}`"
                  class="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-[#05050A] transition hover:border-[#111827] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="isUpdating"
                  @click="emit('payment', { target })"
                >
                  {{ isUpdating ? 'Atualizando...' : getPaymentActionLabel(target) }}
                </button>
              </div>

              <ul
                v-if="order.payment_status_events.length > 0"
                class="mt-1 space-y-1 text-xs text-bip-muted"
                data-cy="order-detail-payment-history"
              >
                <li
                  v-for="event in order.payment_status_events"
                  :key="event.id"
                  class="flex flex-wrap items-baseline gap-x-1.5"
                >
                  <span class="text-[#05050A]">{{ getPaymentStatusLabel(event.new_status) }}</span>
                  <span>· {{ formatDateTimeBR(event.created_at) }}</span>
                  <span v-if="event.performed_by_username">· {{ event.performed_by_username }}</span>
                </li>
              </ul>
            </section>

            <a
              v-if="order.whatsapp_url"
              :href="order.whatsapp_url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-emerald-800 transition hover:bg-emerald-100"
            >
              <ChatBubbleLeftRightIcon class="h-4 w-4" />
              Ver conversa original no WhatsApp
            </a>

            <section v-if="canManage && (canMarkShipped || canMarkDelivered || canCancel)" class="space-y-3 border-t border-[#E5E7EB] pt-4">
              <p v-if="updateError" data-cy="order-detail-update-error" class="text-xs font-semibold text-[#111827]">
                {{ updateError }}
              </p>

              <div v-if="isShipFormOpen" class="space-y-2 rounded-lg border border-[#E5E7EB] bg-zinc-50 p-3">
                <label class="block">
                  <span class="mb-1 block text-[10px] font-black uppercase tracking-widest text-bip-muted">
                    Transportadora
                  </span>
                  <input
                    v-model="carrierNameDraft"
                    type="text"
                    data-cy="ship-form-carrier"
                    class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
                    placeholder="Correios, Jadlog, motoboy..."
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-[10px] font-black uppercase tracking-widest text-bip-muted">
                    Codigo de rastreio
                  </span>
                  <input
                    v-model="trackingCodeDraft"
                    type="text"
                    data-cy="ship-form-tracking-code"
                    class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
                    placeholder="AB123456789BR"
                  />
                </label>
                <p v-if="shipFormValidationError" class="text-xs font-semibold text-[#111827]">
                  {{ shipFormValidationError }}
                </p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-bip-muted transition hover:bg-zinc-50"
                    :disabled="isUpdating"
                    @click="closeShipForm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-cy="ship-form-submit"
                    class="flex-1 rounded-lg bg-[#111827] px-3 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-[#374151] disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="isUpdating"
                    @click="submitShipForm"
                  >
                    {{ isUpdating ? 'Enviando...' : 'Confirmar envio' }}
                  </button>
                </div>
              </div>

              <div v-else class="flex flex-wrap gap-2">
                <button
                  v-if="canMarkShipped"
                  type="button"
                  data-cy="mark-shipped-button"
                  class="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-[#05050A] transition hover:border-[#111827] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="isUpdating"
                  @click="openShipForm"
                >
                  Marcar como enviado
                </button>
                <button
                  v-if="canMarkDelivered"
                  type="button"
                  data-cy="mark-delivered-button"
                  class="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-[#05050A] transition hover:border-[#111827] disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="isUpdating"
                  @click="emit('deliver')"
                >
                  {{ isUpdating ? 'Atualizando...' : 'Marcar como entregue' }}
                </button>
                <button
                  v-if="canCancel"
                  type="button"
                  data-cy="cancel-order-button"
                  class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] px-3 py-2 text-xs font-black uppercase tracking-widest text-[#374151] transition hover:bg-[#F3F4F6]/70 disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="isUpdating"
                  @click="emit('cancel')"
                >
                  Cancelar pedido
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background-color: rgba(9, 9, 11, 0.85);
  backdrop-filter: blur(8px);
}

.modal-container {
  width: 100%;
  max-width: 32rem;
  background-color: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 2rem;
  padding: 2rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
  position: relative;
}

.close-button {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  display: flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  transition: all 0.2s ease;
  z-index: 1;
}

.close-button:hover {
  background-color: #fafafa;
  color: #05050a;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
