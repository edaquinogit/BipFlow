export interface SaleOrderItem {
  id: number
  product_id: number | null
  variant_id: number | null
  product_name: string
  variant_name: string
  variant_color_hex: string
  variant_image_url: string
  sku: string
  quantity: number
  unit_price: string
  line_total: string
}

export type SaleOrderStatus = 'prepared' | 'sent' | 'delivered' | 'cancelled'

// Payment lifecycle (online-sales foundation). Distinct from SaleOrderStatus:
// this tracks whether the money was actually received. Mirrors
// SaleOrder.PAYMENT_STATUS_CHOICES in bipdelivery/api/models.py.
export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refund_pending'
  | 'refunded'
  | 'cancelled'

export type PaymentEventSource = 'system' | 'manual' | 'gateway'

export interface PaymentStatusEvent {
  id: number
  previous_status: PaymentStatus
  new_status: PaymentStatus
  source: PaymentEventSource
  performed_by_username: string | null
  reference: string
  note: string
  created_at: string
}

// Etapa 3 of the QR-code stock-exit evolution: which channel the sale came
// through -- the existing e-commerce/WhatsApp checkout (virtual) or the
// physical-store PDV (loja_fisica). Mirrors SaleOrder.CHANNEL_CHOICES in
// bipdelivery/api/models.py.
export type SaleOrderChannel = 'virtual' | 'loja_fisica'

export interface SaleOrder {
  id: number
  order_reference: string
  status: SaleOrderStatus
  channel: SaleOrderChannel
  customer_name: string
  customer_phone: string
  customer_email: string
  delivery_method: 'delivery' | 'pickup'
  payment_method: 'pix' | 'card' | 'cash'
  // Payment lifecycle (online-sales foundation): on the list payload too, so
  // a row can show a payment badge without opening the detail.
  payment_status: PaymentStatus
  paid_at: string | null
  delivery_region_name: string
  // Etapa R3 of the QR-code stock-exit refinement: who rang up the sale.
  // Always null for a virtual/WhatsApp order (no authenticated staff
  // involved in a public checkout).
  performed_by_username: string | null
  subtotal: string
  delivery_fee: string
  total: string
  created_at: string
  item_count: number
  items: SaleOrderItem[]
}

// Etapa 0 of the pedidos/NF/envio evolution: address/notes/wa.me link only
// the order detail screen needs, kept off the list payload (see
// SaleOrderDetailSerializer in bipdelivery/api/serializers.py).
export interface SaleOrderDetail extends SaleOrder {
  address: string
  neighborhood: string
  city: string
  notes: string
  message: string
  whatsapp_url: string
  // Etapa 1 of the pedidos/NF/envio evolution: manual shipping data,
  // recorded when the order is marked "sent".
  carrier_name: string
  tracking_code: string
  tracking_url: string
  shipped_at: string | null
  delivered_at: string | null
  // Payment lifecycle (online-sales foundation): detail-only fields.
  refunded_at: string | null
  payment_reference: string
  payment_status_events: PaymentStatusEvent[]
  // Payment statuses an operator may move this order to right now
  // (backend `available_manual_targets`).
  available_payment_actions: PaymentStatus[]
}

export interface PaginatedSalesOrdersResponse {
  count: number
  next: string | null
  previous: string | null
  page_size: number
  total_pages: number
  results: SaleOrder[]
}

export interface SaleOrderFilters {
  status?: SaleOrderStatus
  search?: string
  pageSize?: number
  // Etapa 0 of the pedidos/NF/envio evolution: the dashboard's orders list
  // always requested page 1 -- stores with more than a page of orders
  // silently lost the rest. See DashboardOrdersView.vue's pagination.
  page?: number
  // Etapa 5 of the QR-code stock-exit evolution already added this filter
  // on the backend (SaleOrderViewSet.get_base_queryset()); Etapa R4 of the
  // refinement is the first frontend caller (the PDV's "ultimas vendas"
  // panel, DashboardPdvView.vue).
  channel?: SaleOrderChannel
  // Online-sales foundation: narrow the list to one payment state.
  paymentStatus?: PaymentStatus
}

export type SaleOrderSummaryPeriod = 'today' | '7d' | '30d' | '90d' | 'month'

export interface SaleOrderSummary {
  period: SaleOrderSummaryPeriod | 'custom'
  // Order volume (non-cancelled), unchanged meaning for contract compatibility.
  revenue_total: string
  orders_count: number
  average_ticket: string
  comparison_previous_period: string | null
  comparison_same_period_last_year: string | null
  // Money actually received vs. orders merely created (online-sales foundation).
  paid_revenue_total: string
  paid_orders_count: number
  pending_payment_total: string
  pending_payment_count: number
  refund_pending_total: string
  refund_pending_count: number
}

export interface SaleOrderDateRange {
  start: string
  end: string
}

export type SaleOrderTimeseriesPeriod = '7d' | '30d' | '90d'

export interface SaleOrderTimeseriesPoint {
  date: string
  revenue: string
  orders_count: number
}

export interface TopProductBreakdown {
  product_id: number | null
  product_name: string
  image_url: string | null
  quantity_total: number
  revenue_total: string
}

export interface PaymentMethodBreakdown {
  payment_method: SaleOrder['payment_method']
  revenue_total: string
  orders_count: number
  // Confirmed-money slice per method (online-sales foundation).
  paid_revenue_total: string
}

export interface StatusBreakdown {
  status: SaleOrderStatus
  orders_count: number
}

export interface RegionBreakdown {
  region: string
  revenue_total: string
  orders_count: number
}

// Etapa 5 of the QR-code stock-exit evolution: revenue split between the
// virtual (e-commerce/WhatsApp) and loja_fisica (PDV) channels.
export interface ChannelBreakdown {
  channel: SaleOrderChannel
  revenue_total: string
  orders_count: number
}

export interface SaleOrderBreakdown {
  period: SaleOrderSummaryPeriod | 'custom'
  top_products: TopProductBreakdown[]
  by_payment_method: PaymentMethodBreakdown[]
  by_status: StatusBreakdown[]
  by_region: RegionBreakdown[]
  by_channel: ChannelBreakdown[]
}

export interface SaleOrderCustomerInsights {
  period: SaleOrderSummaryPeriod | 'custom'
  new_customers: number
  returning_customers: number
  bot_conversations_count: number
  bot_converted_count: number
  bot_conversion_rate: string | null
  whatsapp_clicks?: number | null
  whatsapp_conversion_rate?: string | null
  whatsapp_converted_orders?: number | null
  average_whatsapp_response_time_seconds?: number | null
}
