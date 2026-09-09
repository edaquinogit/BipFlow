import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PaymentBreakdownCard from '../PaymentBreakdownCard.vue'
import type { PaymentMethodBreakdown, StatusBreakdown } from '@/types/sales'

const mountCard = (props: {
  byPaymentMethod: PaymentMethodBreakdown[]
  byStatus: StatusBreakdown[]
  isLoading: boolean
}) =>
  mount(PaymentBreakdownCard, {
    props,
    global: { stubs: { apexchart: true } },
  })

describe('PaymentBreakdownCard', () => {
  it('shows a loading state', () => {
    const wrapper = mountCard({ byPaymentMethod: [], byStatus: [], isLoading: true })

    expect(wrapper.text()).toContain('Carregando formas de pagamento')
  })

  it('shows an empty state when there is no payment data in the period', () => {
    const wrapper = mountCard({ byPaymentMethod: [], byStatus: [], isLoading: false })

    expect(wrapper.text()).toContain('Nenhuma venda registrada neste periodo')
  })

  it('renders the donut chart when payment data is available', () => {
    const wrapper = mountCard({
      byPaymentMethod: [{ payment_method: 'pix', revenue_total: '40.00', orders_count: 2, paid_revenue_total: '40.00' }],
      byStatus: [],
      isLoading: false,
    })

    expect(wrapper.find('[role="img"]').exists()).toBe(true)
  })

  it('renders a badge per status with the translated label and count', () => {
    const wrapper = mountCard({
      byPaymentMethod: [],
      byStatus: [
        { status: 'prepared', orders_count: 3 },
        { status: 'cancelled', orders_count: 1 },
      ],
      isLoading: false,
    })

    expect(wrapper.text()).toContain('Novo: 3')
    expect(wrapper.text()).toContain('Cancelado: 1')
  })
})
