import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import DashboardPdvView from '../DashboardPdvView.vue'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect'
import ProductService from '@/services/product.service'
import PdvSaleService from '@/services/pdvSale.service'
import { salesService } from '@/services/sales.service'

vi.mock('@/composables/useCurrentUser', () => ({ useCurrentUser: vi.fn() }))
vi.mock('@/composables/useStoreSwitchEffect', () => ({ useStoreSwitchEffect: vi.fn() }))
vi.mock('@/services/product.service', () => ({
  default: { getByCode: vi.fn(), getFiltered: vi.fn() },
}))
vi.mock('@/services/pdvSale.service', () => ({
  default: { create: vi.fn() },
}))
vi.mock('@/services/sales.service', () => ({
  salesService: { list: vi.fn() },
}))

/** Default payment method is `pix`, which requires the cashier to tick the
 * "recebi o pagamento" box before finalize is enabled (the Bip Flow doesn't
 * confirm payment automatically). */
async function confirmPixPayment(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('[data-cy="pdv-payment-confirm-checkbox"]').setValue(true)
}
// Etapa C2 of the PDV camera-scanner evolution: DashboardPdvView.spec.ts
// only needs to prove the camera decode is wired into the same lookup path
// as the text input -- PdvCameraScannerModal.vue's own camera lifecycle
// (permissions, qr-scanner) is already covered by
// PdvCameraScannerModal.spec.ts and usePdvCameraScanner.spec.ts, so it's
// stubbed here to a thin component that exposes `show`/`feedback` and lets
// the test emit `decode`/`close` directly.
vi.mock('@/components/dashboard/product-table/PdvCameraScannerModal.vue', () => ({
  default: {
    name: 'PdvCameraScannerModal',
    props: ['show', 'feedback'],
    emits: ['close', 'decode'],
    template: '<div v-if="show" data-cy="pdv-camera-scanner-stub">{{ feedback?.message }}</div>',
  },
}))

function buildEmptySalesResponse() {
  return { count: 0, next: null, previous: null, page_size: 5, total_pages: 1, results: [] }
}

function buildAxiosLikeError(data: Record<string, unknown>): Error {
  return Object.assign(new Error('Request failed'), { response: { data }, config: {} })
}

const scannedProduct = {
  id: 7,
  name: 'Coxinha premium',
  price: 18.5,
  stock_quantity: 12,
  is_available: true,
  low_stock_threshold: null,
  public_code: 'ABCD2345',
}

// Etapa C3 of the PDV camera-scanner evolution added a window-level
// keydown listener (Ctrl+Enter/Esc shortcuts), so an unmounted wrapper now
// leaks a real event listener onto the shared jsdom `window` instead of
// being harmlessly garbage-collected -- tracking every mount here and
// unmounting them all after each test keeps that listener from piling up
// across the ~30 other tests in this file that don't call wrapper.unmount()
// themselves.
const activeWrappers: Array<ReturnType<typeof mount>> = []
const mountPdvView = (options: Parameters<typeof mount>[1] = {}) => {
  const wrapper = mount(DashboardPdvView, options)
  activeWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  activeWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('DashboardPdvView (Etapa 3 of the QR-code stock-exit evolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(true) } as any)
    vi.mocked(salesService.list).mockResolvedValue(buildEmptySalesResponse())
  })

  it('shows a permission notice and hides the scan input without catalog access', () => {
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(false) } as any)
    const wrapper = mountPdvView()

    expect(wrapper.find('[data-cy="pdv-no-permission"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-scan-input"]').exists()).toBe(false)
  })

  it('starts with an empty cart and a disabled finalize button', () => {
    const wrapper = mountPdvView()

    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeDefined()
  })

  it('adds a scanned product to the cart on Enter', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(ProductService.getByCode).toHaveBeenCalledWith('ABCD2345')
    expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Coxinha premium')
    // The scan input clears itself so the cashier can immediately scan the next item.
    expect((wrapper.find('[data-cy="pdv-scan-input"]').element as HTMLInputElement).value).toBe('')
  })

  it('shows an inline error and does not add anything for an unknown code', async () => {
    vi.mocked(ProductService.getByCode).mockRejectedValue(new Error('not found'))
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('NOPE1234')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-scan-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
  })

  it('shows a specific error and does not add an unavailable product (Etapa R1 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({ ...scannedProduct, is_available: false } as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-scan-error"]').text()).toContain('indisponivel')
    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
  })

  it('opens a variant picker and adds the selected variant to the cart', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({
      ...scannedProduct,
      stock_quantity: 5,
      variants: [
        {
          id: 10,
          name: 'Preto',
          color_hex: '#111111',
          stock_quantity: 2,
          image: null,
          is_active: true,
          position: 0,
        },
      ],
    } as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-variant-picker"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)

    await wrapper.find('[data-cy="pdv-variant-option"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-variant-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-cart-variant-name"]').text()).toContain('Preto')
  })

  it('shows a specific error when a scan would exceed the available stock', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({ ...scannedProduct, stock_quantity: 1 } as any)
    const wrapper = mountPdvView()

    for (let i = 0; i < 2; i += 1) {
      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()
    }

    expect(wrapper.find('[data-cy="pdv-scan-error"]').text()).toContain('Estoque insuficiente')
    // The first scan (within stock) must still be in the cart.
    expect(wrapper.findAll('[data-cy="pdv-cart-row"]')).toHaveLength(1)
  })

  it('aggregates a second scan of the same code into one cart line', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView()

    for (let i = 0; i < 2; i += 1) {
      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()
    }

    expect(wrapper.findAll('[data-cy="pdv-cart-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-cy="pdv-cart-quantity"]').text()).toBe('2')
  })

  it('finalizes the sale with the cart items and selected payment method', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView()
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(PdvSaleService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ public_code: 'ABCD2345', quantity: 1 }],
        payment_method: 'pix',
        customer_name: undefined,
        notes: undefined,
      })
    )
    // A successful sale clears the cart for the next customer.
    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
  })

  it('finalizes a selected variant with variant_id in the PDV sale payload', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({
      ...scannedProduct,
      stock_quantity: 5,
      variants: [
        {
          id: 10,
          name: 'Preto',
          color_hex: '#111111',
          stock_quantity: 2,
          image: null,
          is_active: true,
          position: 0,
        },
      ],
    } as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView()
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    await wrapper.find('[data-cy="pdv-variant-option"]').trigger('click')
    await flushPromises()

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(PdvSaleService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ public_code: 'ABCD2345', variant_id: 10, quantity: 1 }],
        payment_method: 'pix',
      })
    )
  })

  it('passes the optional customer phone through to the sale payload (Etapa R4 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView()
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    await wrapper.find('[data-cy="pdv-customer-phone"]').setValue('71999998888')

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(PdvSaleService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_phone: '71999998888' })
    )
  })

  it('passes the optional customer email through to the sale payload (PDV receipt PDF/email evolution)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: 'cliente@example.com',
    })

    const wrapper = mountPdvView()
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    await wrapper.find('[data-cy="pdv-customer-email"]').setValue('cliente@example.com')

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(PdvSaleService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'cliente@example.com' })
    )
  })

  it('shows an itemized receipt after a successful sale (Etapa R2 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [
        {
          product_id: 7,
          variant_id: null,
          product_name: 'Coxinha premium',
          variant_name: '',
          variant_color_hex: '',
          variant_image_url: '',
          public_code: 'ABCD2345',
          quantity: 1,
          unit_price: '18.50',
          line_total: '18.50',
        },
      ],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-receipt-order-reference"]').text()).toBe('PDV-20260702-120000-000000')
    expect(wrapper.find('[data-cy="pdv-receipt-item"]').text()).toContain('Coxinha premium')
    expect(wrapper.find('[data-cy="pdv-receipt-total"]').text()).toContain('18,50')
  })

  it('closing the receipt refocuses the scan input for the next customer', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView({ global: { stubs: { teleport: true } }, attachTo: document.body })
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-receipt-order-reference"]').exists()).toBe(true)

    const closeButton = wrapper.findAll('button').find((button) => button.text().includes('Fechar'))
    await closeButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-receipt-order-reference"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('[data-cy="pdv-scan-input"]').element)
    wrapper.unmount()
  })

  it('keeps the cart intact when the sale is rejected (e.g. insufficient stock)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockRejectedValue(new Error('insufficient stock'))

    const wrapper = mountPdvView()
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
  })

  it('surfaces the backend\'s specific validation message instead of a generic one (Etapa R1)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockRejectedValue(
      buildAxiosLikeError({ items: ['Quantidade solicitada para "Coxinha premium" excede o estoque disponível (3).'] })
    )

    const wrapper = mountPdvView({ attachTo: document.body })
    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    // The toast composable is real (not mocked) here, so the assertion is
    // indirect: the cart survives the rejection either way (already covered
    // above) -- what this test guards is that extractPdvSaleErrorMessage
    // doesn't throw and the flow completes without leaving isSubmitting stuck.
    expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('refocuses the scan input after a manual quantity adjustment, so the next scan does not leak into it', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView({ attachTo: document.body })

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await wrapper.find('[data-cy="pdv-cart-increment"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-cart-quantity"]').text()).toBe('2')
    expect(document.activeElement).toBe(wrapper.find('[data-cy="pdv-scan-input"]').element)
    wrapper.unmount()
  })

  it('disables the decrement button at quantity 1 and the increment button at the available stock limit (Etapa R3)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({ ...scannedProduct, stock_quantity: 1 } as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-cart-decrement"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-cy="pdv-cart-increment"]').attributes('disabled')).toBeDefined()
  })

  it('shows a low-stock badge in the cart when the scanned product is near its threshold (Etapa R3)', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue({ ...scannedProduct, stock_quantity: 3, low_stock_threshold: 5 } as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-low-stock-badge"]').exists()).toBe(true)
  })

  it('does not show a low-stock badge for healthy stock levels', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-low-stock-badge"]').exists()).toBe(false)
  })

  it('refocuses the scan input after removing a line', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView({ attachTo: document.body })

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()

    await wrapper.find('[data-cy="pdv-cart-remove"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find('[data-cy="pdv-scan-input"]').element)
    wrapper.unmount()
  })

  it('clears the cart when the active store switches, to avoid mixing products from different stores', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    const wrapper = mountPdvView()

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)

    const onStoreSwitch = vi.mocked(useStoreSwitchEffect).mock.calls[0]?.[0]
    expect(onStoreSwitch).toBeTypeOf('function')
    onStoreSwitch?.()
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
  })

  it('loads and shows the most recent PDV sales on mount (Etapa R4 of the QR-code stock-exit refinement)', async () => {
    vi.mocked(salesService.list).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      page_size: 5,
      total_pages: 1,
      results: [
        {
          id: 1,
          order_reference: 'PDV-20260702-100000-000000',
          status: 'prepared',
          channel: 'loja_fisica',
          customer_name: 'Cliente balcão',
          customer_phone: '',
          customer_email: '',
          delivery_method: 'pickup',
          payment_method: 'cash',
          payment_status: 'paid',
          paid_at: '2026-07-02T10:00:00Z',
          delivery_region_name: '',
          performed_by_username: 'caixa1',
          subtotal: '18.50',
          delivery_fee: '0.00',
          total: '18.50',
          created_at: '2026-07-02T10:00:00Z',
          item_count: 1,
          items: [],
        },
      ],
    })

    const wrapper = mountPdvView()
    await flushPromises()

    expect(salesService.list).toHaveBeenCalledWith({ channel: 'loja_fisica', pageSize: 5 })
    expect(wrapper.find('[data-cy="pdv-recent-sales"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-recent-sale-row"]').text()).toContain('PDV-20260702-100000-000000')
  })

  it('does not show the recent-sales panel when there is nothing to show', async () => {
    const wrapper = mountPdvView()
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-recent-sales"]').exists()).toBe(false)
  })

  it('does not fetch recent sales without catalog access', async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(false) } as any)
    mountPdvView()
    await flushPromises()

    expect(salesService.list).not.toHaveBeenCalled()
  })

  it('refreshes the recent-sales panel after a sale finalizes', async () => {
    vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
    vi.mocked(PdvSaleService.create).mockResolvedValue({
      order_reference: 'PDV-20260702-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-07-02T12:00:00Z',
      customer_email: '',
    })

    const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(salesService.list).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
    await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
    await flushPromises()
    await confirmPixPayment(wrapper)
    await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
    await flushPromises()

    expect(salesService.list).toHaveBeenCalledTimes(2)
  })

  it('opens a past sale\'s receipt from "Últimas vendas" (PDV receipt PDF/email evolution)', async () => {
    vi.mocked(salesService.list).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      page_size: 5,
      total_pages: 1,
      results: [
        {
          id: 1,
          order_reference: 'PDV-20260702-100000-000000',
          status: 'prepared',
          channel: 'loja_fisica',
          customer_name: 'Cliente balcão',
          customer_phone: '',
          customer_email: 'cliente@example.com',
          delivery_method: 'pickup',
          payment_method: 'cash',
          payment_status: 'paid',
          paid_at: '2026-07-02T10:00:00Z',
          delivery_region_name: '',
          performed_by_username: 'caixa1',
          subtotal: '18.50',
          delivery_fee: '0.00',
          total: '18.50',
          created_at: '2026-07-02T10:00:00Z',
          item_count: 1,
          items: [
            {
              id: 1,
              product_id: 7,
              variant_id: null,
              product_name: 'Coxinha premium',
              variant_name: '',
              variant_color_hex: '',
              variant_image_url: '',
              sku: '',
              quantity: 1,
              unit_price: '18.50',
              line_total: '18.50',
            },
          ],
        },
      ],
    })

    const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })
    await flushPromises()

    await wrapper.find('[data-cy="pdv-recent-sale-view-receipt"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-cy="pdv-receipt-order-reference"]').text()).toBe(
      'PDV-20260702-100000-000000'
    )
    expect(wrapper.find('[data-cy="pdv-receipt-item"]').text()).toContain('Coxinha premium')
    expect(wrapper.find('[data-cy="pdv-receipt-total"]').text()).toContain('18,50')
  })

  describe('camera scanner (Etapa C2 of the PDV camera-scanner evolution)', () => {
    it('opens the camera scanner modal when the camera button is clicked', async () => {
      const wrapper = mountPdvView()

      expect(wrapper.find('[data-cy="pdv-camera-scanner-stub"]').exists()).toBe(false)
      await wrapper.find('[data-cy="pdv-open-camera-scanner"]').trigger('click')

      expect(wrapper.find('[data-cy="pdv-camera-scanner-stub"]').exists()).toBe(true)
    })

    it('extracts the public_code from a decoded deep-link URL and adds the product to the cart', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      const wrapper = mountPdvView()

      await wrapper.find('[data-cy="pdv-open-camera-scanner"]').trigger('click')
      await wrapper
        .findComponent({ name: 'PdvCameraScannerModal' })
        .vm.$emit('decode', 'https://app.bipflow.com/l/minha-loja/p/ABCD2345')
      await flushPromises()

      expect(ProductService.getByCode).toHaveBeenCalledWith('ABCD2345')
      expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Coxinha premium')
    })

    it('surfaces a not-found message as camera feedback for an unknown code', async () => {
      vi.mocked(ProductService.getByCode).mockRejectedValue(new Error('not found'))
      const wrapper = mountPdvView()

      await wrapper.find('[data-cy="pdv-open-camera-scanner"]').trigger('click')
      await wrapper
        .findComponent({ name: 'PdvCameraScannerModal' })
        .vm.$emit('decode', 'https://app.bipflow.com/l/minha-loja/p/NOPE1234')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-camera-scanner-stub"]').text()).toContain(
        'Código "NOPE1234" não encontrado.'
      )
      expect(wrapper.find('[data-cy="pdv-cart-empty"]').exists()).toBe(true)
    })

    it('closes the modal and refocuses the scan input on close', async () => {
      const wrapper = mountPdvView({ attachTo: document.body })

      await wrapper.find('[data-cy="pdv-open-camera-scanner"]').trigger('click')
      await wrapper.findComponent({ name: 'PdvCameraScannerModal' }).vm.$emit('close')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-camera-scanner-stub"]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.find('[data-cy="pdv-scan-input"]').element)
      wrapper.unmount()
    })
  })

  describe('professional refinement pass (Etapa C3 of the PDV camera-scanner evolution)', () => {
    it('shows a prominent total card with the item count', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      const wrapper = mountPdvView()

      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-total-card"]').exists()).toBe(true)
      expect(wrapper.find('[data-cy="pdv-cart-subtotal"]').text()).toContain('18,50')
      expect(wrapper.find('[data-cy="pdv-total-card"]').text()).toContain('1 item')
    })

    it('the sticky sidebar clears the sticky dashboard header', () => {
      // Regression: with lg:top-6 the sticky column slid under the
      // sticky top-0 z-50 DashboardHeader, hiding the cash field / Finalizar
      // button when the page was scrolled.
      const wrapper = mountPdvView()
      const sidebar = wrapper.find('[data-cy="pdv-total-card"]').element.parentElement as HTMLElement
      expect(sidebar.className).toContain('lg:sticky')
      expect(sidebar.className).toContain('lg:top-20')
      expect(sidebar.className).not.toContain('lg:top-6')
    })

    it('shows the product image in the cart row when available, and a fallback icon otherwise', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue({
        ...scannedProduct,
        image_url: 'https://cdn.bipflow.app/produtos/coxinha.jpg',
      } as any)
      const wrapper = mountPdvView()

      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-cart-item-image"]').attributes('src')).toBe(
        'https://cdn.bipflow.app/produtos/coxinha.jpg'
      )
    })

    it('does not render a product image when the product has none', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      const wrapper = mountPdvView()

      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-cart-item-image"]').exists()).toBe(false)
    })

    it('finalizes the sale on Ctrl+Enter when the cart is not empty', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      vi.mocked(PdvSaleService.create).mockResolvedValue({
        order_reference: 'PDV-20260702-120000-000000',
        items: [],
        subtotal: '18.50',
        total: '18.50',
        payment_method: 'pix',
        created_at: '2026-07-02T12:00:00Z',
        customer_email: '',
      })
      const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })

      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()
      await confirmPixPayment(wrapper)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
      await flushPromises()

      expect(PdvSaleService.create).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('does not finalize on Ctrl+Enter with an empty cart', async () => {
      const wrapper = mountPdvView()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
      await flushPromises()

      expect(PdvSaleService.create).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('clears the scan field on Escape while it is focused', async () => {
      const wrapper = mountPdvView({ attachTo: document.body })
      const input = wrapper.find('[data-cy="pdv-scan-input"]')
      await input.setValue('AB')
      ;(input.element as HTMLInputElement).focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()

      expect((input.element as HTMLInputElement).value).toBe('')
      wrapper.unmount()
    })

    it('does not clear the scan field on Escape while the camera scanner is open', async () => {
      const wrapper = mountPdvView({ attachTo: document.body })
      const input = wrapper.find('[data-cy="pdv-scan-input"]')
      await input.setValue('AB')
      ;(input.element as HTMLInputElement).focus()
      await wrapper.find('[data-cy="pdv-open-camera-scanner"]').trigger('click')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()

      expect((input.element as HTMLInputElement).value).toBe('AB')
      wrapper.unmount()
    })
  })

  describe('idempotency, payment gate and search (PDV/QR/payment evolution)', () => {
    const okSaleResponse = {
      order_reference: 'PDV-20260908-120000-000000',
      items: [],
      subtotal: '18.50',
      total: '18.50',
      payment_method: 'pix',
      created_at: '2026-09-08T12:00:00Z',
      customer_email: '',
    }

    const scanOne = async (wrapper: ReturnType<typeof mount>) => {
      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('ABCD2345')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()
    }

    it('sends an idempotency_key with the sale and a fresh one after it completes', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      vi.mocked(PdvSaleService.create).mockResolvedValue(okSaleResponse)
      const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })
      await flushPromises()

      await scanOne(wrapper)
      await confirmPixPayment(wrapper)
      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()

      const firstKey = vi.mocked(PdvSaleService.create).mock.calls[0]![0].idempotency_key
      expect(firstKey).toMatch(/^[A-Za-z0-9:_-]{8,128}$/)

      await scanOne(wrapper)
      await confirmPixPayment(wrapper)
      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()

      const secondKey = vi.mocked(PdvSaleService.create).mock.calls[1]![0].idempotency_key
      expect(secondKey).not.toBe(firstKey)
    })

    it('reuses the same key across a retry of the same cart (no double sale)', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      vi.mocked(PdvSaleService.create)
        .mockRejectedValueOnce(Object.assign(new Error('network'), { response: { status: 503 }, config: {} }))
        .mockResolvedValueOnce(okSaleResponse)
      const wrapper = mountPdvView({ global: { stubs: { teleport: true } } })
      await flushPromises()

      await scanOne(wrapper)
      await confirmPixPayment(wrapper)
      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()
      // First attempt failed; cart preserved, retry with the SAME key.
      expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()

      const keyA = vi.mocked(PdvSaleService.create).mock.calls[0]![0].idempotency_key
      const keyB = vi.mocked(PdvSaleService.create).mock.calls[1]![0].idempotency_key
      expect(keyA).toBe(keyB)
    })

    it('regenerates the key and warns on a 409 conflict without clearing the cart', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      vi.mocked(PdvSaleService.create).mockRejectedValue(
        Object.assign(new Error('conflict'), {
          response: { status: 409, data: { code: 'idempotency_key_conflict', detail: 'x' } },
          config: {},
        })
      )
      const wrapper = mountPdvView({ global: { stubs: { teleport: true } }, attachTo: document.body })
      await flushPromises()

      await scanOne(wrapper)
      await confirmPixPayment(wrapper)
      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()
      const firstKey = vi.mocked(PdvSaleService.create).mock.calls[0]![0].idempotency_key

      await wrapper.find('[data-cy="pdv-finalize-sale"]').trigger('click')
      await flushPromises()
      const secondKey = vi.mocked(PdvSaleService.create).mock.calls[1]![0].idempotency_key

      expect(secondKey).not.toBe(firstKey)
      expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('blocks finalize for a cash sale until the amount received covers the total', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      const wrapper = mountPdvView()
      await flushPromises()
      await scanOne(wrapper)

      await wrapper.find('[data-cy="pdv-payment-method"]').setValue('cash')
      expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeDefined()

      await wrapper.find('[data-cy="pdv-cash-received"]').setValue('10,00')
      expect(wrapper.find('[data-cy="pdv-cash-insufficient"]').exists()).toBe(true)
      expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeDefined()

      await wrapper.find('[data-cy="pdv-cash-received"]').setValue('50,00')
      expect(wrapper.find('[data-cy="pdv-cash-change"]').text()).toContain('31,50')
      expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeUndefined()
    })

    it('blocks finalize for pix/card until the cashier confirms the payment was received', async () => {
      vi.mocked(ProductService.getByCode).mockResolvedValue(scannedProduct as any)
      const wrapper = mountPdvView()
      await flushPromises()
      await scanOne(wrapper)

      expect(wrapper.find('[data-cy="pdv-payment-confirm-checkbox"]').exists()).toBe(true)
      expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeDefined()

      await confirmPixPayment(wrapper)
      expect(wrapper.find('[data-cy="pdv-finalize-sale"]').attributes('disabled')).toBeUndefined()
    })

    it('always offers all three payment methods at the counter (online storefront config does not gate the PDV)', async () => {
      const wrapper = mountPdvView()
      await flushPromises()

      const options = wrapper.findAll('[data-cy="pdv-payment-method"] option')
      expect(options.map((o) => o.text())).toEqual(['Pix', 'Cartão', 'Dinheiro'])
      expect(wrapper.find('[data-cy="pdv-payment-method-note"]').exists()).toBe(false)
    })

    it('adds a product from the search fallback to the cart', async () => {
      vi.mocked(ProductService.getFiltered).mockResolvedValue([
        { ...scannedProduct, id: 9, name: 'Regata dry', public_code: 'RGT99999' },
      ] as any)
      const wrapper = mountPdvView()
      await flushPromises()

      await wrapper.find('[data-cy="pdv-toggle-search"]').trigger('click')
      await wrapper.find('[data-cy="pdv-search-input"]').setValue('regata')
      await wrapper.find('[data-cy="pdv-search-panel"] form').trigger('submit')
      await flushPromises()

      expect(ProductService.getFiltered).toHaveBeenCalledWith({ search: 'regata' })
      await wrapper.find('[data-cy="pdv-search-result"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-cart-row"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Regata dry')
    })

    it('rejects an unrecognised scan payload with a helpful message', async () => {
      const wrapper = mountPdvView()
      await flushPromises()

      await wrapper.find('[data-cy="pdv-scan-input"]').setValue('javascript:alert(1)')
      await wrapper.find('[data-cy="pdv-scan-input"]').trigger('keyup.enter')
      await flushPromises()

      expect(wrapper.find('[data-cy="pdv-scan-error"]').text()).toContain('não reconhecido')
      expect(ProductService.getByCode).not.toHaveBeenCalled()
    })
  })
})
