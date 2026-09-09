import type {
  PaymentStatus,
  SaleOrder,
  SaleOrderChannel,
  SaleOrderStatus,
} from '@/types/sales';

export const SALE_STATUS_OPTIONS: { value: SaleOrderStatus; label: string }[] = [
  { value: 'prepared', label: 'Novo' },
  { value: 'sent', label: 'Enviado' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'cancelled', label: 'Cancelado' },
];

const SALE_STATUS_LABELS: Record<SaleOrderStatus, string> = {
  prepared: 'Novo',
  sent: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export function getSaleStatusLabel(status: SaleOrderStatus): string {
  return SALE_STATUS_LABELS[status];
}

// Etapa 0 of the pedidos/NF/envio evolution found this map duplicated
// (DashboardOrdersView.vue and PaymentBreakdownCard.vue each kept their own
// copy) with no single source enforcing that a new status gets added to
// every screen that shows a badge -- centralized here so that gap can't
// recur silently.
const SALE_STATUS_BADGE_CLASS: Record<SaleOrderStatus, string> = {
  prepared: 'border-amber-200 bg-amber-50 text-amber-800',
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  delivered: 'border-sky-200 bg-sky-50 text-sky-800',
  cancelled: 'border-[#111827]/20 bg-[#F3F4F6] text-[#374151]',
};

export function getSaleStatusBadgeClass(status: SaleOrderStatus): string {
  return SALE_STATUS_BADGE_CLASS[status];
}

// Etapa 1 of the pedidos/NF/envio evolution: the 3rd timeline step
// (Novo -> Enviado -> Entregue).
export const SALE_TIMELINE_STEPS: { value: Exclude<SaleOrderStatus, 'cancelled'>; label: string }[] = [
  { value: 'prepared', label: 'Novo' },
  { value: 'sent', label: 'Enviado' },
  { value: 'delivered', label: 'Entregue' },
];

const PAYMENT_METHOD_LABELS: Record<SaleOrder['payment_method'], string> = {
  pix: 'Pix',
  card: 'Cartao',
  cash: 'Dinheiro',
};

export function getPaymentLabel(paymentMethod: SaleOrder['payment_method']): string {
  return PAYMENT_METHOD_LABELS[paymentMethod];
}

export function getDeliveryMethodLabel(deliveryMethod: SaleOrder['delivery_method']): string {
  return deliveryMethod === 'delivery' ? 'Delivery' : 'Retirada';
}

// Etapa 3/5 of the QR-code stock-exit evolution.
const CHANNEL_LABELS: Record<SaleOrderChannel, string> = {
  virtual: 'Virtual',
  loja_fisica: 'Loja fisica',
};

export function getChannelLabel(channel: SaleOrderChannel): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

// Etapa 0 of the pedidos/NF/envio evolution: the backend already supported
// ?channel= on the orders list (Etapa 5 of the QR-code stock-exit
// evolution), but no screen exposed it as a filter until now.
export const CHANNEL_FILTER_OPTIONS: { value: SaleOrderChannel; label: string }[] = [
  { value: 'virtual', label: 'Virtual' },
  { value: 'loja_fisica', label: 'Loja fisica' },
];

// --- Payment lifecycle (online-sales foundation) ---
//
// Payment status is distinct from operational status: `status` tracks
// fulfilment (Novo -> Enviado -> Entregue), `payment_status` tracks whether
// the money was received. Single source of truth for every payment badge /
// label / action label -- mirrors SaleOrder.PAYMENT_STATUS_CHOICES and
// PAYMENT_STATUS_LABELS in bipdelivery/api/payments.py.

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pagamento pendente',
  paid: 'Pago',
  failed: 'Pagamento falhou',
  refund_pending: 'Reembolso pendente',
  refunded: 'Reembolsado',
  cancelled: 'Pagamento cancelado',
};

export function getPaymentStatusLabel(paymentStatus: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus;
}

const PAYMENT_STATUS_BADGE_CLASS: Record<PaymentStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  refund_pending: 'border-orange-300 bg-orange-50 text-orange-800',
  refunded: 'border-sky-200 bg-sky-50 text-sky-800',
  cancelled: 'border-[#111827]/20 bg-[#F3F4F6] text-[#374151]',
};

export function getPaymentStatusBadgeClass(paymentStatus: PaymentStatus): string {
  return PAYMENT_STATUS_BADGE_CLASS[paymentStatus] ?? PAYMENT_STATUS_BADGE_CLASS.pending;
}

// Operator action labels, keyed by the transition target the backend's
// `available_payment_actions` returns (bipdelivery/api/payments.py's
// MANUAL_OPERATOR_TARGETS). "Confirmar reembolso realizado" is deliberately
// worded as confirming an external refund -- Bip Flow never executes one.
const PAYMENT_ACTION_LABELS: Record<PaymentStatus, string> = {
  paid: 'Confirmar pagamento',
  failed: 'Registrar falha no pagamento',
  pending: 'Registrar nova tentativa',
  refunded: 'Confirmar reembolso realizado',
  refund_pending: 'Abrir pendência de reembolso',
  cancelled: 'Cancelar pagamento',
};

export function getPaymentActionLabel(target: PaymentStatus): string {
  return PAYMENT_ACTION_LABELS[target] ?? target;
}

export const PAYMENT_STATUS_FILTER_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'pending', label: 'Pagamento pendente' },
  { value: 'paid', label: 'Pago' },
  { value: 'failed', label: 'Pagamento falhou' },
  { value: 'refund_pending', label: 'Reembolso pendente' },
  { value: 'refunded', label: 'Reembolsado' },
  { value: 'cancelled', label: 'Pagamento cancelado' },
];
