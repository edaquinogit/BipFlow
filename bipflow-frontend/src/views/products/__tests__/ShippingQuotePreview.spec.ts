import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ShippingQuotePreview from '../ShippingQuotePreview.vue'
import type { CartItem } from '@/types/product'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/services/api', () => ({ default: { get, post } }))

const item = { product: { id: 1 }, quantity: 2 } as CartItem
const result = { data: { simulated: true, quotes: [
  { service: 'economico_simulado', price: '16.00', estimated_days: 4 },
] } }

async function setup() {
  const wrapper = mount(ShippingQuotePreview, { props: { storeSlug: 'a', items: [item] } })
  await flushPromises()
  return wrapper
}

describe('ShippingQuotePreview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    get.mockResolvedValue({ data: { enabled: true } })
    post.mockResolvedValue(result)
  })

  it('hides disabled feature', async () => {
    get.mockResolvedValue({ data: { enabled: false } })
    const wrapper = await setup()
    expect(wrapper.find('section').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('sends only CEP and cart items and allows preview selection', async () => {
    const wrapper = await setup()
    await wrapper.get('input').setValue('49010000')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('v1/public/stores/a/shipping-quotes/', {
      destination_postal_code: '49010000', items: [{ product_id: 1, quantity: 2 }],
    })
    await wrapper.get('input[type=radio]').setValue()
    expect(wrapper.text()).toContain('não altera o pedido')
    await wrapper.get('input').setValue('40010000')
    expect(wrapper.find('input[type=radio]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('discards a response after cart changes', async () => {
    let resolve!: (value: typeof result) => void
    post.mockReturnValue(new Promise<typeof result>(r => { resolve = r }))
    const wrapper = await setup()
    await wrapper.get('input').setValue('49010000')
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ items: [{ ...item, quantity: 3 }] })
    resolve(result)
    await flushPromises()
    expect(wrapper.find('input[type=radio]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears quotes when switching tenant', async () => {
    const wrapper = await setup()
    await wrapper.get('input').setValue('49010000')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    get.mockResolvedValue({ data: { enabled: false } })
    await wrapper.setProps({ storeSlug: 'b' })
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
    wrapper.unmount()
  })

  it('confirms only a server-enabled quote with valid UF and invalidates on CEP change', async () => {
    post.mockResolvedValue({ data: { ...result.data, order_confirmation_available: true } })
    const wrapper = await setup()
    await wrapper.get('#shipping-preview-cep').setValue('49010000')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('input[type=radio]').setValue()
    const confirm = wrapper.findAll('button').find(b => b.text() === 'Usar frete simulado')!
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('input[maxlength="2"]').setValue('se')
    await confirm.trigger('click')
    expect(wrapper.emitted('selection')?.at(-1)).toEqual([{
      destination_postal_code: '49010000', state: 'SE',
      service: 'economico_simulado', expected_price: '16.00',
    }])
    await wrapper.get('#shipping-preview-cep').setValue('40010000')
    expect(wrapper.emitted('selection')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('shows a safe error on failed quote', async () => {
    post.mockRejectedValue(new Error('internal'))
    const wrapper = await setup()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Não foi possível')
    wrapper.unmount()
  })
})
