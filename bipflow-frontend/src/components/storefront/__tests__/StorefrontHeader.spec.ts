import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontHeader from '../StorefrontHeader.vue'

// jsdom has no matchMedia -> useMediaQuery returns false -> the header renders
// its mobile layout (brand + actions row, plus a search row for the catalog).

const RouterLinkStub = {
  props: ['to'],
  template: '<a><slot /></a>',
}

const mountHeader = (props: Record<string, unknown> = {}) =>
  mount(StorefrontHeader, {
    props: { storeName: 'Boutique Fitness', ...props } as never,
    slots: { account: '<button data-test="account">conta</button>' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('StorefrontHeader', () => {
  it('renders the brand, the account slot and a cart control', () => {
    const wrapper = mountHeader()
    expect(wrapper.text()).toContain('Boutique Fitness')
    expect(wrapper.find('[data-test="account"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="open-cart-button"]').exists()).toBe(true)
  })

  it('shows the search + filter row for the catalog variant', () => {
    const wrapper = mountHeader({ variant: 'catalog' })
    expect(wrapper.find('input[aria-label="Buscar produtos por nome"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Abrir filtros"]').exists()).toBe(true)
  })

  it('omits the search row for the detail variant', () => {
    const wrapper = mountHeader({ variant: 'detail' })
    expect(wrapper.find('input[aria-label="Buscar produtos por nome"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Abrir filtros"]').exists()).toBe(false)
  })

  it('emits update:search with the raw typed value', async () => {
    const wrapper = mountHeader({ variant: 'catalog' })
    await wrapper.find('input[aria-label="Buscar produtos por nome"]').setValue('camisa ')
    expect(wrapper.emitted('update:search')?.at(-1)).toEqual(['camisa '])
  })

  it('emits open-cart and toggle-filters', async () => {
    const wrapper = mountHeader({ variant: 'catalog' })
    await wrapper.find('[data-cy="open-cart-button"]').trigger('click')
    await wrapper.find('[aria-label="Abrir filtros"]').trigger('click')
    expect(wrapper.emitted('open-cart')).toHaveLength(1)
    expect(wrapper.emitted('toggle-filters')).toHaveLength(1)
  })

  it('describes the cart contents in the accessible label', () => {
    const wrapper = mountHeader({ itemCount: 2, subtotal: 199.9 })
    const label = wrapper.find('[data-cy="open-cart-button"]').attributes('aria-label') ?? ''
    expect(label).toContain('2 itens')
    expect(label).toContain('R$')
  })

  it('shows the active filter count on the filter trigger', () => {
    const wrapper = mountHeader({ variant: 'catalog', activeFilterCount: 3 })
    expect(wrapper.find('[aria-label="Abrir filtros"]').text()).toContain('3')
  })
})
