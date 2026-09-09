import api from './api'
import type {
  PaginatedSalesOrdersResponse,
  PaymentStatus,
  SaleOrderBreakdown,
  SaleOrderCustomerInsights,
  SaleOrderDateRange,
  SaleOrderDetail,
  SaleOrderFilters,
  SaleOrderStatus,
  SaleOrderSummary,
  SaleOrderSummaryPeriod,
  SaleOrderTimeseriesPeriod,
  SaleOrderTimeseriesPoint,
} from '@/types/sales'

const buildRangeParams = (
  periodOrRange: SaleOrderSummaryPeriod | SaleOrderTimeseriesPeriod | SaleOrderDateRange
): Record<string, string> => {
  if (typeof periodOrRange === 'string') {
    return { period: periodOrRange }
  }

  return { start: periodOrRange.start, end: periodOrRange.end }
}

export const salesService = {
  async list(filters: SaleOrderFilters = {}): Promise<PaginatedSalesOrdersResponse> {
    const params: Record<string, string | number> = {
      page_size: filters.pageSize ?? 5,
    }

    if (filters.status) {
      params.status = filters.status
    }

    if (filters.search?.trim()) {
      params.search = filters.search.trim()
    }

    if (filters.channel) {
      params.channel = filters.channel
    }

    if (filters.paymentStatus) {
      params.payment_status = filters.paymentStatus
    }

    if (filters.page) {
      params.page = filters.page
    }

    const response = await api.get<PaginatedSalesOrdersResponse>('v1/sales-orders/', { params })
    return response.data
  },

  async get(orderId: number): Promise<SaleOrderDetail> {
    const response = await api.get<SaleOrderDetail>(`v1/sales-orders/${orderId}/`)
    return response.data
  },

  // Etapa 1 of the pedidos/NF/envio evolution: carrier/tracking are only
  // required by the backend when status is "sent" (see update_status in
  // bipdelivery/api/views.py). The backend always returns the fuller detail
  // shape for this action so the detail modal can show the just-recorded
  // shipping data without a second request.
  async updateStatus(
    orderId: number,
    status: SaleOrderStatus,
    shipping?: { carrierName: string; trackingCode: string }
  ): Promise<SaleOrderDetail> {
    const response = await api.patch<SaleOrderDetail>(`v1/sales-orders/${orderId}/status/`, {
      status,
      ...(shipping ? { carrier_name: shipping.carrierName, tracking_code: shipping.trackingCode } : {}),
    })

    return response.data
  },

  // Online-sales foundation: record what happened to an order's payment. The
  // backend re-checks that `paymentStatus` is a legal move from the order's
  // current state (see update_payment in bipdelivery/api/views.py) and
  // returns the fuller detail shape so the modal can refresh badge + history
  // without a second request.
  async updatePayment(
    orderId: number,
    paymentStatus: PaymentStatus,
    options?: { reference?: string; note?: string }
  ): Promise<SaleOrderDetail> {
    const response = await api.patch<SaleOrderDetail>(
      `v1/sales-orders/${orderId}/payment/`,
      {
        payment_status: paymentStatus,
        ...(options?.reference ? { reference: options.reference } : {}),
        ...(options?.note ? { note: options.note } : {}),
      }
    )

    return response.data
  },

  async summary(
    periodOrRange: SaleOrderSummaryPeriod | SaleOrderDateRange = '30d'
  ): Promise<SaleOrderSummary> {
    const response = await api.get<SaleOrderSummary>('v1/sales-orders/summary/', {
      params: buildRangeParams(periodOrRange),
    })

    return response.data
  },

  async timeseries(
    periodOrRange: SaleOrderTimeseriesPeriod | SaleOrderDateRange = '30d'
  ): Promise<SaleOrderTimeseriesPoint[]> {
    const response = await api.get<SaleOrderTimeseriesPoint[]>('v1/sales-orders/timeseries/', {
      params: buildRangeParams(periodOrRange),
    })

    return response.data
  },

  async breakdown(
    periodOrRange: SaleOrderSummaryPeriod | SaleOrderDateRange = '30d'
  ): Promise<SaleOrderBreakdown> {
    const response = await api.get<SaleOrderBreakdown>('v1/sales-orders/breakdown/', {
      params: buildRangeParams(periodOrRange),
    })

    return response.data
  },

  async customers(
    periodOrRange: SaleOrderSummaryPeriod | SaleOrderDateRange = '30d'
  ): Promise<SaleOrderCustomerInsights> {
    const response = await api.get<SaleOrderCustomerInsights>('v1/sales-orders/customers/', {
      params: buildRangeParams(periodOrRange),
    })

    return response.data
  },
}
