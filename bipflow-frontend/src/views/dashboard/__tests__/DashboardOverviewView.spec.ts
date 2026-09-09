import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import DashboardOverviewView from '../DashboardOverviewView.vue'
import { useProducts } from '@/composables/useProducts'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { salesService } from '@/services/sales.service'

vi.mock('@/composables/useProducts', () => ({ useProducts: vi.fn() }))
vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/services/sales.service', () => ({
  salesService: {
    summary: vi.fn(),
    timeseries: vi.fn(),
    breakdown: vi.fn(),
    customers: vi.fn(),
  },
}))

const mountOverview = () =>
  mount(DashboardOverviewView, {
    global: {
      stubs: {
        apexchart: true,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })

describe('DashboardOverviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProducts).mockReturnValue({
      loading: ref(false),
      inventoryStats: ref({ totalItems: 10, lowStockCount: 1 }),
      outOfStockProducts: ref([{ id: 1, name: 'Zeroed Product', stock_quantity: 0, is_available: false }]),
      lowStockProducts: ref([]),
      fetchData: vi.fn(),
    } as any)
    vi.mocked(useCurrentStore).mockReturnValue({ selectedStore: ref(null) } as any)
  })

  it('shows an error banner when the analytics request fails', async () => {
    vi.mocked(salesService.summary).mockResolvedValue({
      period: '30d',
      revenue_total: '0.00',
      orders_count: 0,
      average_ticket: '0.00',
      comparison_previous_period: null,
      comparison_same_period_last_year: null,
      paid_revenue_total: '0.00',
      paid_orders_count: 0,
      pending_payment_total: '0.00',
      pending_payment_count: 0,
      refund_pending_total: '0.00',
      refund_pending_count: 0,
    })
    vi.mocked(salesService.timeseries).mockRejectedValue(new Error('network down'))
    vi.mocked(salesService.breakdown).mockResolvedValue({
      period: '30d', top_products: [], by_payment_method: [], by_status: [], by_region: [], by_channel: [],
    })
    vi.mocked(salesService.customers).mockResolvedValue({
      period: '30d', new_customers: 0, returning_customers: 0, bot_conversations_count: 0, bot_converted_count: 0, bot_conversion_rate: null,
    })

    const wrapper = mountOverview()
    await flushPromises()

    expect(wrapper.text()).toContain('Nao foi possivel carregar a analise de vendas agora.')
  })

  it('renders the sales volume plus the confirmed / pending money split', async () => {
    vi.mocked(salesService.summary).mockResolvedValue({
      period: '30d',
      revenue_total: '150.00',
      orders_count: 3,
      average_ticket: '50.00',
      comparison_previous_period: '10.00',
      comparison_same_period_last_year: null,
      paid_revenue_total: '90.00',
      paid_orders_count: 1,
      pending_payment_total: '40.00',
      pending_payment_count: 1,
      refund_pending_total: '20.00',
      refund_pending_count: 1,
    })
    vi.mocked(salesService.timeseries).mockResolvedValue([])
    vi.mocked(salesService.breakdown).mockResolvedValue({
      period: '30d', top_products: [], by_payment_method: [], by_status: [], by_region: [], by_channel: [],
    })
    vi.mocked(salesService.customers).mockResolvedValue({
      period: '30d', new_customers: 0, returning_customers: 0, bot_conversations_count: 0, bot_converted_count: 0, bot_conversion_rate: null,
    })

    const wrapper = mountOverview()
    await flushPromises()

    // Big number = order volume; the label no longer says "Receita".
    expect(wrapper.text()).toContain('150,00')
    expect(wrapper.text()).toContain('Vendas (30 dias)')
    expect(wrapper.text()).not.toContain('Receita de vendas')

    const subtitle = wrapper.get('[data-cy="revenue-card-subtitle"]').text()
    expect(subtitle).toContain('90,00 recebido')
    expect(subtitle).toContain('40,00 pendente')
    expect(subtitle).toContain('20,00 a reembolsar')
  })

  it('opens the stock alert drawer with the critical products when the alert card is clicked', async () => {
    vi.mocked(salesService.summary).mockResolvedValue({
      period: '30d',
      revenue_total: '0.00',
      orders_count: 0,
      average_ticket: '0.00',
      comparison_previous_period: null,
      comparison_same_period_last_year: null,
      paid_revenue_total: '0.00',
      paid_orders_count: 0,
      pending_payment_total: '0.00',
      pending_payment_count: 0,
      refund_pending_total: '0.00',
      refund_pending_count: 0,
    })
    vi.mocked(salesService.timeseries).mockResolvedValue([])
    vi.mocked(salesService.breakdown).mockResolvedValue({
      period: '30d', top_products: [], by_payment_method: [], by_status: [], by_region: [], by_channel: [],
    })
    vi.mocked(salesService.customers).mockResolvedValue({
      period: '30d', new_customers: 0, returning_customers: 0, bot_conversations_count: 0, bot_converted_count: 0, bot_conversion_rate: null,
    })

    const wrapper = mountOverview()
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    const alertCard = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Alertas criticos'))
    expect(alertCard).toBeDefined()

    await alertCard!.trigger('click')

    const drawer = wrapper.find('[role="dialog"]')
    expect(drawer.exists()).toBe(true)
    expect(drawer.text()).toContain('Zeroed Product')
  })
})
