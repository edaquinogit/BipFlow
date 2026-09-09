import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import DashboardOrdersView from '../DashboardOrdersView.vue'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { useToast } from '@/composables/useToast'
import { salesService } from '@/services/sales.service'
import type { PaginatedSalesOrdersResponse, SaleOrder, SaleOrderDetail } from '@/types/sales'

vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/composables/useCurrentUser', () => ({ useCurrentUser: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: vi.fn() }))
vi.mock('@/services/sales.service', () => ({
  salesService: {
    list: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(),
    updatePayment: vi.fn(),
  },
}))

function buildOrder(overrides: Partial<SaleOrder> = {}): SaleOrder {
  return {
    id: 1,
    order_reference: 'BPF-0001',
    status: 'prepared',
    channel: 'virtual',
    customer_name: 'Cliente Teste',
    customer_phone: '71999990000',
    customer_email: '',
    delivery_method: 'pickup',
    payment_method: 'pix',
    payment_status: 'pending',
    paid_at: null,
    delivery_region_name: '',
    performed_by_username: null,
    subtotal: '50.00',
    delivery_fee: '0.00',
    total: '50.00',
    created_at: '2026-06-20T10:00:00Z',
    item_count: 1,
    items: [],
    ...overrides,
  }
}

function buildOrderDetail(overrides: Partial<SaleOrderDetail> = {}): SaleOrderDetail {
  return {
    ...buildOrder({ delivery_method: 'delivery' }),
    address: 'Rua das Flores, 123',
    neighborhood: 'Centro',
    city: 'Salvador',
    notes: 'Sem cebola, por favor',
    message: 'Pedido via WhatsApp',
    whatsapp_url: 'https://wa.me/5571999990000',
    carrier_name: '',
    tracking_code: '',
    tracking_url: '',
    shipped_at: null,
    delivered_at: null,
    refunded_at: null,
    payment_reference: '',
    payment_status_events: [],
    available_payment_actions: [],
    ...overrides,
  }
}

function buildResponse(
  results: SaleOrder[],
  overrides: Partial<PaginatedSalesOrdersResponse> = {}
): PaginatedSalesOrdersResponse {
  return {
    count: results.length,
    next: null,
    previous: null,
    page_size: 20,
    total_pages: 1,
    results,
    ...overrides,
  }
}

describe('DashboardOrdersView', () => {
  const toastState = { success: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCurrentStore).mockReturnValue({ selectedStore: ref(null) } as any)
    vi.mocked(useCurrentUser).mockReturnValue({ canManageOrders: ref(true) } as any)
    vi.mocked(useToast).mockReturnValue(toastState as any)
  })

  it('shows the loading skeleton while the history request is in flight', async () => {
    let resolveList: (value: PaginatedSalesOrdersResponse) => void = () => {}
    vi.mocked(salesService.list).mockReturnValue(new Promise((resolve) => { resolveList = resolve }))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Nenhuma venda registrada ainda.')

    resolveList(buildResponse([]))
    await flushPromises()

    expect(wrapper.text()).toContain('Nenhuma venda registrada ainda.')
  })

  it('shows an error banner when the history request fails', async () => {
    vi.mocked(salesService.list).mockRejectedValue(new Error('network down'))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.text()).toContain('Não foi possível carregar o histórico agora.')
  })

  it('shows the empty state when there are no orders', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([]))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.text()).toContain('Nenhuma venda registrada ainda.')
  })

  it('renders fetched orders with their status label', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.text()).toContain('Cliente Teste')
    expect(wrapper.text()).toContain('Novo')
  })

  it('shows a payment badge on each order row (online-sales foundation)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([
        buildOrder({ id: 1, payment_status: 'paid' }),
        buildOrder({ id: 2, payment_status: 'refund_pending' }),
      ]),
    )

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    const badges = wrapper.findAll('[data-cy="sale-payment-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0]?.text()).toBe('Pago')
    expect(badges[1]?.text()).toBe('Reembolso pendente')
  })

  it('confirms a payment from the detail modal and patches the row without reload', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([buildOrder({ id: 1, payment_status: 'pending' })]),
    )
    vi.mocked(salesService.get).mockResolvedValue(
      buildOrderDetail({ id: 1, payment_status: 'pending', available_payment_actions: ['paid', 'failed'] }),
    )
    vi.mocked(salesService.updatePayment).mockResolvedValue(
      buildOrderDetail({ id: 1, payment_status: 'paid', available_payment_actions: [] }),
    )

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-cy="payment-action-paid"]').trigger('click')
    await flushPromises()

    expect(salesService.updatePayment).toHaveBeenCalledWith(1, 'paid')
    expect(salesService.list).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-cy="sale-payment-badge"]').text()).toBe('Pago')
  })

  it('shows a channel badge distinguishing PDV sales from virtual orders (Etapa 3/5 of the QR-code stock-exit evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([buildOrder({ id: 1, channel: 'loja_fisica' }), buildOrder({ id: 2, channel: 'virtual' })])
    )

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.text()).toContain('Loja fisica')
    expect(wrapper.text()).toContain('Virtual')
  })

  it('shows the operator badge only for PDV sales with a known operator (Etapa R3 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([
        buildOrder({ id: 1, channel: 'loja_fisica', performed_by_username: 'caixa1' }),
        buildOrder({ id: 2, channel: 'loja_fisica', performed_by_username: null }),
        buildOrder({ id: 3, channel: 'virtual', performed_by_username: 'caixa1' }),
      ])
    )

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    const badges = wrapper.findAll('[data-cy="sale-operator-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]?.text()).toContain('caixa1')
  })

  it('marks a pickup order as delivered directly from the detail modal (Etapa 1 of the pedidos/NF/envio evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([buildOrder({ delivery_method: 'pickup' })])
    )
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail({ delivery_method: 'pickup' }))
    vi.mocked(salesService.updateStatus).mockResolvedValue(
      buildOrderDetail({ delivery_method: 'pickup', status: 'delivered' })
    )

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-cy="mark-delivered-button"]').trigger('click')
    await flushPromises()

    expect(salesService.updateStatus).toHaveBeenCalledWith(1, 'delivered')
    expect(toastState.success).toHaveBeenCalledWith('Pedido marcado como entregue.')
    expect(salesService.list).toHaveBeenCalledTimes(1)
  })

  it('marks a delivery order as shipped via the ship form in the detail modal', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([buildOrder({ delivery_method: 'delivery' })])
    )
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail({ delivery_method: 'delivery' }))
    vi.mocked(salesService.updateStatus).mockResolvedValue(
      buildOrderDetail({
        delivery_method: 'delivery',
        status: 'sent',
        carrier_name: 'Correios',
        tracking_code: 'AB123456789BR',
      })
    )

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-cy="mark-shipped-button"]').trigger('click')
    await wrapper.find('[data-cy="ship-form-carrier"]').setValue('Correios')
    await wrapper.find('[data-cy="ship-form-tracking-code"]').setValue('AB123456789BR')
    await wrapper.find('[data-cy="ship-form-submit"]').trigger('click')
    await flushPromises()

    expect(salesService.updateStatus).toHaveBeenCalledWith(
      1, 'sent', { carrierName: 'Correios', trackingCode: 'AB123456789BR' }
    )
    expect(toastState.success).toHaveBeenCalledWith('Pedido marcado como enviado.')
  })

  it('asks for confirmation instead of cancelling immediately (Etapa R2 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder({ item_count: 2 })]))
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail({ item_count: 2 }))

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-cy="cancel-order-button"]').trigger('click')
    await flushPromises()

    // The cancellation itself must not fire until the confirmation is accepted.
    expect(salesService.updateStatus).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Cancelar pedido?')
    expect(wrapper.text()).toContain('estoque de 2 item(ns) sera devolvido')
  })

  it('cancels the order only after the confirmation is accepted', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail())
    vi.mocked(salesService.updateStatus).mockResolvedValue(buildOrderDetail({ status: 'cancelled' }))

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-cy="cancel-order-button"]').trigger('click')
    await flushPromises()

    const confirmButton = wrapper.findAll('button').find((button) => button.text().includes('Confirmar cancelamento'))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(salesService.updateStatus).toHaveBeenCalledWith(1, 'cancelled')
    expect(toastState.success).toHaveBeenCalledWith('Status do pedido atualizado.')
  })

  it('does not cancel the order when the confirmation is dismissed', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail())

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-cy="cancel-order-button"]').trigger('click')
    await flushPromises()

    const cancelButton = wrapper.findAll('button').find((button) => button.text().includes('Cancelar') && !button.text().includes('cancelamento'))
    expect(cancelButton).toBeTruthy()
    await cancelButton!.trigger('click')
    await flushPromises()

    expect(salesService.updateStatus).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Cancelar pedido?')
  })

  it('sends the channel filter and resets to page 1 when a channel is selected (Etapa 0 of the pedidos/NF/envio evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    await wrapper.find('[data-cy="sales-channel-filter"]').setValue('loja_fisica')
    await flushPromises()

    expect(salesService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'loja_fisica', page: 1 })
    )
  })

  it('shows pagination controls and requests the next page (Etapa 0 of the pedidos/NF/envio evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(
      buildResponse([buildOrder()], { next: 'http://api/v1/sales-orders/?page=2', total_pages: 2 })
    )

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    const prevButton = wrapper.find('[data-cy="sales-pagination-prev"]')
    const nextButton = wrapper.find('[data-cy="sales-pagination-next"]')
    expect(prevButton.attributes('disabled')).toBeDefined()
    expect(nextButton.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Página 1 de 2')

    await nextButton.trigger('click')
    await flushPromises()

    expect(salesService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('does not show pagination controls when there is only one page', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))

    const wrapper = mount(DashboardOrdersView)
    await flushPromises()

    expect(wrapper.find('[data-cy="sales-pagination-next"]').exists()).toBe(false)
  })

  it('opens the order detail modal with the fetched order (Etapa 0 of the pedidos/NF/envio evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))
    vi.mocked(salesService.get).mockResolvedValue(buildOrderDetail())

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()

    expect(salesService.get).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Rua das Flores, 123')
    expect(wrapper.text()).toContain('Sem cebola, por favor')
    expect(wrapper.find('a[href="https://wa.me/5571999990000"]').exists()).toBe(true)
  })

  it('shows an error message when the order detail fetch fails', async () => {
    vi.mocked(salesService.list).mockResolvedValue(buildResponse([buildOrder()]))
    vi.mocked(salesService.get).mockRejectedValue(new Error('network down'))

    const wrapper = mount(DashboardOrdersView, { global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="sale-detail-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Não foi possível carregar os detalhes deste pedido.')
  })
})
