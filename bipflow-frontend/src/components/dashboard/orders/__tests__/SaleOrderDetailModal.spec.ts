import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SaleOrderDetailModal from '../SaleOrderDetailModal.vue'
import type { SaleOrderDetail } from '@/types/sales'

function buildOrderDetail(overrides: Partial<SaleOrderDetail> = {}): SaleOrderDetail {
  return {
    id: 1,
    order_reference: 'BPF-0001',
    status: 'prepared',
    channel: 'virtual',
    customer_name: 'Cliente Teste',
    customer_phone: '71999990000',
    customer_email: 'cliente@example.com',
    delivery_method: 'delivery',
    payment_method: 'pix',
    payment_status: 'pending',
    paid_at: null,
    delivery_region_name: 'Centro',
    performed_by_username: null,
    subtotal: '50.00',
    delivery_fee: '5.00',
    total: '55.00',
    created_at: '2026-06-20T10:00:00Z',
    item_count: 1,
    items: [
      {
        id: 1,
        product_id: 9,
        variant_id: null,
        product_name: 'Pizza Margherita',
        variant_name: '',
        variant_color_hex: '',
        variant_image_url: '',
        sku: '',
        quantity: 1,
        unit_price: '50.00',
        line_total: '50.00',
      },
    ],
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

const mountModal = (props: Partial<InstanceType<typeof SaleOrderDetailModal>['$props']> = {}) =>
  mount(SaleOrderDetailModal, {
    props: {
      show: true,
      order: buildOrderDetail(),
      isLoading: false,
      error: null,
      canManage: true,
      isUpdating: false,
      updateError: null,
      ...props,
    },
    global: { stubs: { teleport: true } },
  })

describe('SaleOrderDetailModal', () => {
  it('renders carrier, tracking code and the tracking link once shipped', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({
        status: 'sent',
        carrier_name: 'Correios',
        tracking_code: 'AB123456789BR',
        tracking_url: 'https://rastreamento.correios.com.br/app/index.php?objeto=AB123456789BR',
        shipped_at: '2026-07-08T12:00:00Z',
      }),
    })

    expect(wrapper.text()).toContain('Correios')
    expect(wrapper.text()).toContain('AB123456789BR')
    expect(wrapper.find('a[href="https://rastreamento.correios.com.br/app/index.php?objeto=AB123456789BR"]').exists()).toBe(true)
  })

  it('builds a wa.me notify-customer link with the tracking code once shipped', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({
        status: 'sent',
        customer_phone: '71999990000',
        carrier_name: 'Correios',
        tracking_code: 'AB123456789BR',
      }),
    })

    const link = wrapper.find('[data-cy="notify-customer-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toContain('https://wa.me/71999990000?text=')
    expect(decodeURIComponent(link.attributes('href') ?? '')).toContain('AB123456789BR')
  })

  it('does not render the notify-customer link before the order has shipped', () => {
    const wrapper = mountModal({ order: buildOrderDetail({ status: 'prepared', carrier_name: '', tracking_code: '' }) })

    expect(wrapper.find('[data-cy="notify-customer-link"]').exists()).toBe(false)
  })

  it('renders the address, notes and whatsapp link for a delivery order', () => {
    const wrapper = mountModal()

    expect(wrapper.text()).toContain('Rua das Flores, 123')
    expect(wrapper.text()).toContain('Centro')
    expect(wrapper.text()).toContain('Sem cebola, por favor')
    expect(wrapper.find('a[href="https://wa.me/5571999990000"]').exists()).toBe(true)
  })

  it('does not render delivery address fields for a pickup order', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({ delivery_method: 'pickup', address: '', neighborhood: '', city: '' }),
    })

    expect(wrapper.text()).not.toContain('Rua das Flores, 123')
  })

  it('shows a loading state instead of order content', () => {
    const wrapper = mountModal({ isLoading: true, order: null })

    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Cliente Teste')
  })

  it('shows an error message instead of order content', () => {
    const wrapper = mountModal({ error: 'Não foi possível carregar os detalhes deste pedido.', order: null })

    expect(wrapper.text()).toContain('Não foi possível carregar os detalhes deste pedido.')
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = mountModal()

    await wrapper.find('button[aria-label="Fechar"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders nothing when show is false', () => {
    const wrapper = mountModal({ show: false })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('shows the ship action for a prepared delivery order and hides it once shipped', () => {
    const preparedDelivery = mountModal({
      order: buildOrderDetail({ status: 'prepared', delivery_method: 'delivery' }),
    })
    expect(preparedDelivery.find('[data-cy="mark-shipped-button"]').exists()).toBe(true)

    const alreadySent = mountModal({ order: buildOrderDetail({ status: 'sent', delivery_method: 'delivery' }) })
    expect(alreadySent.find('[data-cy="mark-shipped-button"]').exists()).toBe(false)
    expect(alreadySent.find('[data-cy="mark-delivered-button"]').exists()).toBe(true)
  })

  it('shows deliver directly (no ship step) for a prepared pickup order', () => {
    const wrapper = mountModal({ order: buildOrderDetail({ status: 'prepared', delivery_method: 'pickup' }) })

    expect(wrapper.find('[data-cy="mark-shipped-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="mark-delivered-button"]').exists()).toBe(true)
  })

  it('hides every action once the order is delivered', () => {
    const wrapper = mountModal({ order: buildOrderDetail({ status: 'delivered' }) })

    expect(wrapper.find('[data-cy="mark-shipped-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="mark-delivered-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="cancel-order-button"]').exists()).toBe(false)
  })

  it('hides every action when the viewer cannot manage orders', () => {
    const wrapper = mountModal({ canManage: false, order: buildOrderDetail({ status: 'prepared' }) })

    expect(wrapper.find('[data-cy="mark-shipped-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="cancel-order-button"]').exists()).toBe(false)
  })

  it('requires carrier and tracking code before emitting ship', async () => {
    const wrapper = mountModal({ order: buildOrderDetail({ status: 'prepared', delivery_method: 'delivery' }) })

    await wrapper.find('[data-cy="mark-shipped-button"]').trigger('click')
    await wrapper.find('[data-cy="ship-form-submit"]').trigger('click')

    expect(wrapper.emitted('ship')).toBeUndefined()
    expect(wrapper.text()).toContain('Informe a transportadora e o codigo de rastreio.')

    await wrapper.find('[data-cy="ship-form-carrier"]').setValue('Correios')
    await wrapper.find('[data-cy="ship-form-tracking-code"]').setValue('AB123456789BR')
    await wrapper.find('[data-cy="ship-form-submit"]').trigger('click')

    expect(wrapper.emitted('ship')).toEqual([[{ carrierName: 'Correios', trackingCode: 'AB123456789BR' }]])
  })

  it('emits deliver and cancel from their respective buttons', async () => {
    const wrapper = mountModal({ order: buildOrderDetail({ status: 'sent' }) })

    await wrapper.find('[data-cy="mark-delivered-button"]').trigger('click')
    expect(wrapper.emitted('deliver')).toHaveLength(1)

    await wrapper.find('[data-cy="cancel-order-button"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('shows updateError near the actions without hiding the rest of the order', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({ status: 'prepared' }),
      updateError: 'Não foi possível marcar o pedido como enviado. Tente novamente.',
    })

    expect(wrapper.text()).toContain('Não foi possível marcar o pedido como enviado. Tente novamente.')
    expect(wrapper.text()).toContain('Cliente Teste')
  })

  // --- Online-sales foundation: payment section ---

  it('renders the payment badge and confirmed-time for a paid order', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({
        payment_status: 'paid',
        paid_at: '2026-06-21T12:00:00Z',
        payment_reference: 'TED 4432',
        available_payment_actions: [],
      }),
    })

    expect(wrapper.get('[data-cy="order-detail-payment-badge"]').text()).toBe('Pago')
    const section = wrapper.get('[data-cy="order-detail-payment"]').text()
    expect(section).toContain('Pago em')
    expect(section).toContain('TED 4432')
    expect(wrapper.find('[data-cy="order-detail-payment-actions"]').exists()).toBe(false)
  })

  it('offers the operator actions the backend allows', async () => {
    const wrapper = mountModal({
      order: buildOrderDetail({ payment_status: 'pending', available_payment_actions: ['paid', 'failed'] }),
    })

    expect(wrapper.get('[data-cy="payment-action-paid"]').text()).toBe('Confirmar pagamento')
    expect(wrapper.get('[data-cy="payment-action-failed"]').text()).toBe('Registrar falha no pagamento')

    await wrapper.get('[data-cy="payment-action-paid"]').trigger('click')
    expect(wrapper.emitted('payment')).toEqual([[{ target: 'paid' }]])
  })

  it('shows the refund-pending warning and, for a viewer, no action buttons', () => {
    const wrapper = mountModal({
      canManage: false,
      order: buildOrderDetail({
        status: 'cancelled',
        payment_status: 'refund_pending',
        available_payment_actions: ['refunded'],
      }),
    })

    expect(wrapper.get('[data-cy="order-detail-refund-warning"]').text())
      .toContain('O Bip Flow não processa reembolsos')
    // Viewer: no "e confirme abaixo" and no buttons.
    expect(wrapper.get('[data-cy="order-detail-refund-warning"]').text()).not.toContain('confirme abaixo')
    expect(wrapper.find('[data-cy="order-detail-payment-actions"]').exists()).toBe(false)
    // But the badge is still visible.
    expect(wrapper.get('[data-cy="order-detail-payment-badge"]').text()).toBe('Reembolso pendente')
  })

  it('renders the payment history when events exist', () => {
    const wrapper = mountModal({
      order: buildOrderDetail({
        payment_status: 'paid',
        available_payment_actions: [],
        payment_status_events: [
          {
            id: 1,
            previous_status: 'pending',
            new_status: 'paid',
            source: 'manual',
            performed_by_username: 'caixa1',
            reference: '',
            note: '',
            created_at: '2026-06-21T12:00:00Z',
          },
        ],
      }),
    })

    const history = wrapper.get('[data-cy="order-detail-payment-history"]').text()
    expect(history).toContain('Pago')
    expect(history).toContain('caixa1')
  })
})
