<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ClockIcon, EyeIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline';
import { useAsyncResource } from '@/composables/useAsyncResource';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import { useCurrentUser } from '@/composables/useCurrentUser';
import { useToast } from '@/composables/useToast';
import {
  CHANNEL_FILTER_OPTIONS,
  getChannelLabel,
  getDeliveryMethodLabel,
  getPaymentLabel,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  getSaleStatusBadgeClass,
  getSaleStatusLabel,
  PAYMENT_STATUS_FILTER_OPTIONS,
  SALE_STATUS_OPTIONS,
  SALE_TIMELINE_STEPS,
} from '@/constants/saleOrder';
import type {
  PaginatedSalesOrdersResponse,
  PaymentStatus,
  SaleOrder,
  SaleOrderChannel,
  SaleOrderDetail,
  SaleOrderFilters,
  SaleOrderStatus,
} from '@/types/sales';
import { Logger } from '@/services/logger';
import { buildErrorContext, type ApplicationError } from '@/types/errors';
import { salesService } from '@/services/sales.service';
import { useDebounceFn } from '@/utils/debounce';
import { formatBRL } from '@/utils/formatters';
import ConfirmModal from '@/components/dashboard/layout/ConfirmModal.vue';
import SaleOrderDetailModal from '@/components/dashboard/orders/SaleOrderDetailModal.vue';

const { canManageOrders } = useCurrentUser();
const { success, error: toastError } = useToast();

const { data: salesHistory, isLoading: isSalesLoading, error: salesError, run: runSalesHistory } = (
  useAsyncResource<PaginatedSalesOrdersResponse>()
);
const recentSales = computed(() => salesHistory.value?.results ?? []);
const updatingSaleOrderId = ref<number | null>(null);

// Etapa R2 of the QR-code stock-exit refinement (see
// docs/architecture/qrcode-stock-exit-refinement.md): cancelling now
// restocks every item automatically (bipdelivery/api/stock.py's
// apply_order_cancellation()) -- a real, semi-irreversible side effect that
// didn't exist before, so it gets its own confirmation instead of firing
// immediately like every other status transition.
const orderPendingCancellation = ref<SaleOrder | null>(null);
const isCancelConfirmOpen = computed(() => orderPendingCancellation.value !== null);
const cancelConfirmMessage = computed(() => {
  const order = orderPendingCancellation.value;
  if (!order) {
    return '';
  }
  return `O pedido ${order.order_reference} sera cancelado e o estoque de ${order.item_count} item(ns) sera devolvido automaticamente. Essa acao nao pode ser desfeita.`;
});

const salesSearchTerm = ref('');
const salesStatusFilter = ref<'all' | SaleOrderStatus>('all');
const salesChannelFilter = ref<'all' | SaleOrderChannel>('all');
const salesPaymentFilter = ref<'all' | PaymentStatus>('all');
const salesPage = ref(1);
const saleStatusOptions = SALE_STATUS_OPTIONS;
const saleChannelOptions = CHANNEL_FILTER_OPTIONS;
const salePaymentOptions = PAYMENT_STATUS_FILTER_OPTIONS;
const saleTimelineSteps = SALE_TIMELINE_STEPS;

const hasActiveSalesFilters = computed(() => (
  salesSearchTerm.value.trim() !== ''
  || salesStatusFilter.value !== 'all'
  || salesChannelFilter.value !== 'all'
  || salesPaymentFilter.value !== 'all'
));

// Etapa 0 of the pedidos/NF/envio evolution: the orders list used to always
// request page 1 and never read count/next/previous back -- stores with
// more than a page of orders silently lost the rest.
const totalPages = computed(() => salesHistory.value?.total_pages ?? 1);
const hasNextPage = computed(() => salesHistory.value?.next !== null && salesHistory.value?.next !== undefined);
const hasPreviousPage = computed(() => (
  salesHistory.value?.previous !== null && salesHistory.value?.previous !== undefined
));

function buildSalesFilters(): Omit<SaleOrderFilters, 'pageSize'> {
  return {
    search: salesSearchTerm.value.trim() || undefined,
    status: salesStatusFilter.value === 'all' ? undefined : salesStatusFilter.value,
    channel: salesChannelFilter.value === 'all' ? undefined : salesChannelFilter.value,
    paymentStatus: salesPaymentFilter.value === 'all' ? undefined : salesPaymentFilter.value,
    page: salesPage.value,
  };
}

const fetchSalesHistory = (filters: SaleOrderFilters = {}): Promise<void> => (
  runSalesHistory(
    () => salesService.list({ pageSize: 20, ...filters }),
    'Não foi possível carregar o histórico agora.'
  )
);

const [emitSalesFiltersDebounced, cancelSalesFiltersDebounce] = useDebounceFn(() => {
  salesPage.value = 1;
  void fetchSalesHistory(buildSalesFilters());
}, 320);

watch(salesSearchTerm, () => {
  emitSalesFiltersDebounced();
});

watch([salesStatusFilter, salesChannelFilter, salesPaymentFilter], () => {
  cancelSalesFiltersDebounce();
  salesPage.value = 1;
  void fetchSalesHistory(buildSalesFilters());
});

function goToPage(page: number): void {
  if (page < 1 || page > totalPages.value || page === salesPage.value) {
    return;
  }
  salesPage.value = page;
  void fetchSalesHistory(buildSalesFilters());
}

useStoreSwitchEffect(() => {
  salesPage.value = 1;
  void fetchSalesHistory(buildSalesFilters());
});

onBeforeUnmount(() => {
  cancelSalesFiltersDebounce();
});

// Etapa 1 of the pedidos/NF/envio evolution: patches both the list row and
// the open detail modal (if it's showing this same order) from a single
// mutation response, so neither goes stale after a status change.
function applyUpdatedOrder(updatedOrder: SaleOrderDetail): void {
  if (salesHistory.value) {
    salesHistory.value = {
      ...salesHistory.value,
      results: salesHistory.value.results.map((sale) => (
        sale.id === updatedOrder.id ? updatedOrder : sale
      )),
    };
  }
  if (selectedOrderDetail.value?.id === updatedOrder.id) {
    selectedOrderDetail.value = updatedOrder;
  }
}

const handleUpdateSaleStatus = async (orderId: number, nextStatus: SaleOrderStatus): Promise<void> => {
  updatingSaleOrderId.value = orderId;

  try {
    const updatedOrder = await salesService.updateStatus(orderId, nextStatus);
    applyUpdatedOrder(updatedOrder);
    success('Status do pedido atualizado.');
  } catch (error: unknown) {
    Logger.error('Sale order status update failed', buildErrorContext(error as ApplicationError, { orderId, nextStatus }));
    toastError('Não foi possível atualizar o pedido.');
  } finally {
    updatingSaleOrderId.value = null;
  }
};

function formatSaleDate(dateString: string): string {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return 'Data indisponível';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// Etapa 1 of the pedidos/NF/envio evolution: a pickup order has no shipping
// leg, so its timeline skips "Enviado" entirely (Novo -> Entregue) instead
// of showing a step it will never legitimately pass through.
function getSaleTimelineSteps(sale: SaleOrder) {
  return sale.delivery_method === 'pickup'
    ? saleTimelineSteps.filter((step) => step.value !== 'sent')
    : saleTimelineSteps;
}

function isSaleTimelineStepReached(sale: SaleOrder, stepStatus: SaleOrderStatus): boolean {
  const steps = getSaleTimelineSteps(sale);
  const currentIndex = steps.findIndex((step) => step.value === sale.status);
  const stepIndex = steps.findIndex((step) => step.value === stepStatus);
  return currentIndex !== -1 && stepIndex !== -1 && stepIndex <= currentIndex;
}

function getSaleTimelineStepClass(sale: SaleOrder, stepStatus: SaleOrderStatus): string {
  return isSaleTimelineStepReached(sale, stepStatus)
    ? getSaleStatusBadgeClass(stepStatus)
    : 'border-[#E5E7EB] bg-zinc-50 text-bip-muted';
}

function closeCancelConfirm(): void {
  orderPendingCancellation.value = null;
}

async function confirmCancellation(): Promise<void> {
  const order = orderPendingCancellation.value;
  if (!order) {
    return;
  }

  await handleUpdateSaleStatus(order.id, 'cancelled');
  orderPendingCancellation.value = null;
}

const isDetailModalOpen = ref(false);
const isDetailLoading = ref(false);
const detailError = ref<string | null>(null);
const selectedOrderDetail = ref<SaleOrderDetail | null>(null);
const modalUpdateError = ref<string | null>(null);
const isDetailUpdating = computed(() => (
  selectedOrderDetail.value !== null && updatingSaleOrderId.value === selectedOrderDetail.value.id
));

async function openOrderDetail(order: SaleOrder): Promise<void> {
  isDetailModalOpen.value = true;
  isDetailLoading.value = true;
  detailError.value = null;
  modalUpdateError.value = null;
  selectedOrderDetail.value = null;

  try {
    selectedOrderDetail.value = await salesService.get(order.id);
  } catch (error: unknown) {
    Logger.error('Sale order detail fetch failed', buildErrorContext(error as ApplicationError, { orderId: order.id }));
    detailError.value = 'Não foi possível carregar os detalhes deste pedido.';
  } finally {
    isDetailLoading.value = false;
  }
}

function closeOrderDetail(): void {
  isDetailModalOpen.value = false;
}

// Etapa 1 of the pedidos/NF/envio evolution: status-changing actions now
// live in SaleOrderDetailModal.vue instead of the loose <select> the order
// card used to have -- keeps mutations behind an explicit "Detalhes" step
// instead of a stray dropdown that's easy to mis-click.
async function handleMarkShipped(
  order: SaleOrderDetail,
  shipping: { carrierName: string; trackingCode: string }
): Promise<void> {
  updatingSaleOrderId.value = order.id;
  modalUpdateError.value = null;

  try {
    const updatedOrder = await salesService.updateStatus(order.id, 'sent', shipping);
    applyUpdatedOrder(updatedOrder);
    success('Pedido marcado como enviado.');
  } catch (error: unknown) {
    Logger.error('Sale order ship failed', buildErrorContext(error as ApplicationError, { orderId: order.id }));
    modalUpdateError.value = 'Não foi possível marcar o pedido como enviado. Tente novamente.';
  } finally {
    updatingSaleOrderId.value = null;
  }
}

async function handleMarkDelivered(order: SaleOrderDetail): Promise<void> {
  updatingSaleOrderId.value = order.id;
  modalUpdateError.value = null;

  try {
    const updatedOrder = await salesService.updateStatus(order.id, 'delivered');
    applyUpdatedOrder(updatedOrder);
    success('Pedido marcado como entregue.');
  } catch (error: unknown) {
    Logger.error('Sale order deliver failed', buildErrorContext(error as ApplicationError, { orderId: order.id }));
    modalUpdateError.value = 'Não foi possível marcar o pedido como entregue. Tente novamente.';
  } finally {
    updatingSaleOrderId.value = null;
  }
}

function handleCancelFromModal(order: SaleOrderDetail): void {
  orderPendingCancellation.value = order;
  isDetailModalOpen.value = false;
}

// Online-sales foundation: an operator payment action from the detail modal.
// The backend returns the fuller detail shape, so applyUpdatedOrder patches
// both the list row and the open modal -- no reload.
async function handleUpdatePayment(
  order: SaleOrderDetail,
  target: PaymentStatus,
): Promise<void> {
  updatingSaleOrderId.value = order.id;
  modalUpdateError.value = null;

  try {
    const updatedOrder = await salesService.updatePayment(order.id, target);
    applyUpdatedOrder(updatedOrder);
    success('Pagamento atualizado.');
  } catch (error: unknown) {
    Logger.error(
      'Sale order payment update failed',
      buildErrorContext(error as ApplicationError, { orderId: order.id, target }),
    );
    const message =
      'Não foi possível atualizar o pagamento. Revise e tente novamente.';
    modalUpdateError.value = message;
    // Toast too: the modal's updateError banner only renders alongside the
    // operational-status actions, which a delivered/paid order no longer has.
    toastError(message);
  } finally {
    updatingSaleOrderId.value = null;
  }
}

onMounted(() => {
  void fetchSalesHistory();
});
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[0.4em] text-bip-muted">Vendas</p>
        <h1 class="mt-1 text-xl font-black italic tracking-tighter text-[#05050A]">Pedidos</h1>
      </div>
    </div>

    <div class="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_170px_170px_190px]">
      <label class="relative block">
        <span class="sr-only">Buscar pedido</span>
        <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bip-muted" />
        <input
          v-model="salesSearchTerm"
          type="search"
          class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white pl-10 pr-3 text-sm text-[#05050A] outline-none transition placeholder:text-bip-muted/70 focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
          placeholder="Cliente, telefone ou referência"
        />
      </label>

      <label class="block">
        <span class="sr-only">Filtrar por status</span>
        <select
          v-model="salesStatusFilter"
          class="h-11 w-full appearance-none rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
        >
          <option value="all">Todos status</option>
          <option v-for="option in saleStatusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="sr-only">Filtrar por canal</span>
        <select
          v-model="salesChannelFilter"
          data-cy="sales-channel-filter"
          class="h-11 w-full appearance-none rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
        >
          <option value="all">Todos canais</option>
          <option v-for="option in saleChannelOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="sr-only">Filtrar por pagamento</span>
        <select
          v-model="salesPaymentFilter"
          data-cy="sales-payment-filter"
          class="h-11 w-full appearance-none rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
        >
          <option value="all">Todos pagamentos</option>
          <option v-for="option in salePaymentOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div v-if="isSalesLoading" class="rounded-lg border border-[#E5E7EB] bg-white p-4 sm:col-span-2 xl:col-span-3">
        <div class="h-4 w-32 animate-pulse rounded bg-zinc-100" />
        <div class="mt-3 h-3 w-48 animate-pulse rounded bg-zinc-100" />
      </div>

      <div v-else-if="salesError" class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-4 text-sm text-[#374151] sm:col-span-2 xl:col-span-3">
        {{ salesError }}
      </div>

      <div v-else-if="recentSales.length === 0" class="rounded-lg border border-[#E5E7EB] bg-white p-4 sm:col-span-2 xl:col-span-3">
        <p class="text-sm font-semibold text-[#05050A]">
          {{ hasActiveSalesFilters ? 'Nenhum pedido encontrado.' : 'Nenhuma venda registrada ainda.' }}
        </p>
        <p class="mt-1 text-xs leading-5 text-bip-muted">
          {{
            hasActiveSalesFilters
              ? 'Ajuste a busca ou o filtro de status.'
              : 'Os pedidos finalizados pela vitrine aparecem aqui automaticamente.'
          }}
        </p>
      </div>

      <template v-else>
        <article
          v-for="sale in recentSales"
          :key="sale.id"
          class="rounded-lg border border-[#E5E7EB] bg-white p-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="truncate text-sm font-bold text-[#05050A]">{{ sale.customer_name }}</p>
              <p class="mt-1 flex items-center gap-1.5 text-xs text-bip-muted">
                <ClockIcon class="h-3.5 w-3.5" />
                {{ formatSaleDate(sale.created_at) }} - {{ getPaymentLabel(sale.payment_method) }}
              </p>
            </div>
            <p class="shrink-0 text-sm font-black text-[#111827]">
              {{ formatBRL(sale.total) }}
            </p>
          </div>

          <div class="mt-3 flex items-center justify-between gap-3">
            <p class="text-xs text-bip-muted">
              {{ sale.item_count }} item<span v-if="sale.item_count !== 1">s</span> - {{ sale.order_reference }}
            </p>
            <button
              type="button"
              data-cy="sale-detail-button"
              class="flex shrink-0 items-center gap-1 rounded-full border border-[#E5E7EB] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-bip-muted transition hover:border-[#111827] hover:text-[#111827]"
              @click="openOrderDetail(sale)"
            >
              <EyeIcon class="h-3.5 w-3.5" />
              Detalhes
            </button>
          </div>

          <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-bip-muted">
            <span
              class="rounded-full border px-2.5 py-1"
              :class="sale.channel === 'loja_fisica'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-[#E5E7EB] bg-zinc-50 text-bip-muted'"
            >
              {{ getChannelLabel(sale.channel) }}
            </span>
            <span
              v-if="sale.channel === 'loja_fisica' && sale.performed_by_username"
              data-cy="sale-operator-badge"
              class="rounded-full border border-[#E5E7EB] bg-zinc-50 px-2.5 py-1"
            >
              Operador: {{ sale.performed_by_username }}
            </span>
            <span class="rounded-full border border-[#E5E7EB] bg-zinc-50 px-2.5 py-1">
              {{ getDeliveryMethodLabel(sale.delivery_method) }}
            </span>
            <span
              v-if="sale.delivery_region_name"
              class="max-w-full truncate rounded-full border border-[#E5E7EB] bg-zinc-50 px-2.5 py-1"
            >
              {{ sale.delivery_region_name }}
            </span>
          </div>

          <div class="mt-4 rounded-lg border border-[#E5E7EB] bg-zinc-50 p-3">
            <div
              v-if="sale.status === 'cancelled'"
              class="flex items-center gap-2 rounded-lg border border-[#111827]/20 bg-[#F3F4F6] px-3 py-2 text-xs font-black uppercase tracking-widest text-[#374151]"
            >
              <span class="h-2 w-2 rounded-full bg-[#111827]" />
              Pedido cancelado
            </div>

            <div
              v-else
              class="grid gap-2"
              :class="getSaleTimelineSteps(sale).length === 3 ? 'grid-cols-3' : 'grid-cols-2'"
            >
              <div
                v-for="step in getSaleTimelineSteps(sale)"
                :key="step.value"
                class="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                :class="getSaleTimelineStepClass(sale, step.value)"
              >
                <span
                  class="h-2 w-2 rounded-full"
                  :class="isSaleTimelineStepReached(sale, step.value) ? 'bg-current' : 'bg-zinc-300'"
                />
                {{ step.label }}
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <span
              class="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest"
              :class="getSaleStatusBadgeClass(sale.status)"
            >
              {{ getSaleStatusLabel(sale.status) }}
            </span>
            <span
              class="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest"
              :class="getPaymentStatusBadgeClass(sale.payment_status)"
              data-cy="sale-payment-badge"
            >
              {{ getPaymentStatusLabel(sale.payment_status) }}
            </span>
          </div>
        </article>
      </template>
    </div>

    <div
      v-if="!isSalesLoading && !salesError && recentSales.length > 0 && (hasNextPage || hasPreviousPage)"
      class="mt-6 flex items-center justify-between gap-3"
    >
      <button
        type="button"
        data-cy="sales-pagination-prev"
        class="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-bold text-[#05050A] transition hover:border-[#111827] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!hasPreviousPage"
        @click="goToPage(salesPage - 1)"
      >
        Anterior
      </button>
      <p class="text-[11px] font-bold uppercase tracking-widest text-bip-muted">
        Página {{ salesPage }} de {{ totalPages }}
      </p>
      <button
        type="button"
        data-cy="sales-pagination-next"
        class="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-bold text-[#05050A] transition hover:border-[#111827] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!hasNextPage"
        @click="goToPage(salesPage + 1)"
      >
        Próxima
      </button>
    </div>

    <ConfirmModal
      :show="isCancelConfirmOpen"
      title="Cancelar pedido?"
      :message="cancelConfirmMessage"
      confirm-label="Confirmar cancelamento"
      loading-label="Cancelando..."
      :is-loading="orderPendingCancellation !== null && updatingSaleOrderId === orderPendingCancellation.id"
      @close="closeCancelConfirm"
      @confirm="confirmCancellation"
    />

    <SaleOrderDetailModal
      :show="isDetailModalOpen"
      :order="selectedOrderDetail"
      :is-loading="isDetailLoading"
      :error="detailError"
      :can-manage="canManageOrders"
      :is-updating="isDetailUpdating"
      :update-error="modalUpdateError"
      @close="closeOrderDetail"
      @ship="(shipping) => selectedOrderDetail && handleMarkShipped(selectedOrderDetail, shipping)"
      @deliver="() => selectedOrderDetail && handleMarkDelivered(selectedOrderDetail)"
      @cancel="() => selectedOrderDetail && handleCancelFromModal(selectedOrderDetail)"
      @payment="({ target }) => selectedOrderDetail && handleUpdatePayment(selectedOrderDetail, target)"
    />
  </div>
</template>
