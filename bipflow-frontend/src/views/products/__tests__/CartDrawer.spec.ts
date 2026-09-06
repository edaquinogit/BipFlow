import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CartDrawer from '../CartDrawer.vue'
import type { CartCustomer, CartItem } from '@/types/product'
import type { CustomerProfile } from '@/types/customer'
import type { DeliveryRegion } from '@/types/delivery'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, fullPath: '/produtos' }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const buildCustomer = (overrides: Partial<CartCustomer> = {}): CartCustomer => ({
  deliveryMethod: 'pickup',
  paymentMethod: 'pix',
  deliveryRegionId: null,
  deliveryRegionName: '',
  deliveryRegionFee: 0,
  notes: '',
  fullName: 'Convidado Teste',
  phone: '11999990000',
  email: '',
  address: 'Rua Teste, 100',
  neighborhood: 'Centro',
  city: 'Salvador',
  ...overrides,
})

const buildProfile = (overrides: Partial<CustomerProfile> = {}): CustomerProfile => ({
  full_name: 'Maria Cliente',
  phone: '11988887777',
  email: 'maria@example.com',
  address: 'Rua das Flores, 42',
  neighborhood: 'Jardim',
  city: 'Sao Paulo',
  delivery_region_id: null,
  delivery_region_name: '',
  ...overrides,
})

const buildItem = (): CartItem => ({
  product: {
    id: 1,
    name: 'Combo Executivo',
    slug: 'combo-executivo',
    price: '42.50',
    category: { id: 1, name: 'Lanches', slug: 'lanches' },
    image: null,
    stock_quantity: 10,
    is_available: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  quantity: 1,
})

const buildRegion = (overrides: Partial<DeliveryRegion> = {}): DeliveryRegion => ({
  id: 1,
  name: 'Centro',
  city: 'Salvador',
  neighborhoods: '',
  delivery_fee: '12.00',
  is_active: true,
  ...overrides,
})

const mountDrawer = (props: Partial<InstanceType<typeof CartDrawer>['$props']> = {}) =>
  mount(CartDrawer, {
    attachTo: document.body,
    props: {
      isOpen: true,
      items: [buildItem()],
      itemCount: 1,
      subtotal: 42.5,
      deliveryFee: 0,
      total: 42.5,
      customer: buildCustomer(),
      deliveryRegions: [],
      isWhatsAppConfigured: true,
      profile: null,
      ...props,
    },
  })

type Drawer = ReturnType<typeof mountDrawer>

async function goToDetails(wrapper: Drawer): Promise<void> {
  await wrapper.get('[data-cy="checkout-continue-button"]').trigger('click')
}

const submitBtn = (wrapper: Drawer) => wrapper.get('[data-cy="checkout-submit-button"]')

describe('CartDrawer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('step flow', () => {
    it('opens on the review step showing the items, not the form', () => {
      const wrapper = mountDrawer()
      expect(wrapper.find('[data-cy="checkout-continue-button"]').exists()).toBe(true)
      expect(wrapper.find('[data-cy="checkout-submit-button"]').exists()).toBe(false)
      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Combo Executivo')
    })

    it('moves to the details step on "Continuar" and back on "Voltar ao pedido"', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)

      expect(wrapper.find('[data-cy="checkout-submit-button"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Finalizar pedido')

      await wrapper.get('[aria-label="Voltar ao pedido"]').trigger('click')
      expect(wrapper.find('[data-cy="checkout-continue-button"]').exists()).toBe(true)
      expect(wrapper.find('[data-cy="checkout-submit-button"]').exists()).toBe(false)
    })

    it('moves focus to the details heading after advancing to the details step', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)

      const detailsHeading = wrapper.get('h3')
      expect(detailsHeading.text()).toContain('Finalizar pedido')
      expect(document.activeElement).toBe(detailsHeading.element)
    })

    it('moves focus to the review heading after going back to "Voltar ao pedido"', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      await wrapper.get('[aria-label="Voltar ao pedido"]').trigger('click')

      const reviewHeading = wrapper.get('h2')
      expect(reviewHeading.text()).toContain('Pedido')
      expect(document.activeElement).toBe(reviewHeading.element)
    })

    it('preserves typed customer data across a back-and-forth', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      await wrapper.get('input[autocomplete="name"]').setValue('Ana')
      expect(wrapper.emitted('updateCustomer')).toContainEqual([{ fullName: 'Ana' }])

      // going back and forward does not clear the field (state lives in the parent)
      await wrapper.get('[aria-label="Voltar ao pedido"]').trigger('click')
      await goToDetails(wrapper)
      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(true)
    })

    it('returns to review when the drawer is reopened', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      await wrapper.setProps({ isOpen: false })
      await wrapper.setProps({ isOpen: true })
      expect(wrapper.find('[data-cy="checkout-continue-button"]').exists()).toBe(true)
    })

    it('has no steps and offers a way back to the catalog when the cart is empty', () => {
      const wrapper = mountDrawer({ items: [], itemCount: 0 })
      expect(wrapper.find('[data-cy="checkout-continue-button"]').exists()).toBe(false)
      expect(wrapper.find('[data-cy="checkout-submit-button"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Seu pedido está vazio')
      const back = wrapper.findAll('button').find((b) => b.text().includes('Ver catálogo'))
      expect(back).toBeDefined()
    })

    it('blocks "Continuar" while an item exceeds its stock', () => {
      const item = {
        ...buildItem(),
        quantity: 3,
        variant: {
          id: 9, name: 'Azul', color_hex: '#3366FF', price: null, effective_price: '42.50',
          stock_quantity: 2, image: 'https://example.com/azul.jpg', is_active: true, position: 0,
        },
      }
      const wrapper = mountDrawer({ items: [item], itemCount: 3 })
      expect(wrapper.get('[data-cy="checkout-continue-button"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('2 disponiveis nesta cor')
    })

    it('blocks "Continuar" when the store has no WhatsApp configured', () => {
      const wrapper = mountDrawer({ isWhatsAppConfigured: false })
      expect(wrapper.get('[data-cy="checkout-continue-button"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('WhatsApp da loja ainda não configurado.')
    })
  })

  describe('review step', () => {
    it('shows the variant effective price per unit and in the line total', () => {
      const item = {
        ...buildItem(),
        quantity: 2,
        variant: {
          id: 9, name: 'Premium', color_hex: '#3366FF', price: '59.90', effective_price: '59.90',
          stock_quantity: 4, image: null, is_active: true, position: 0,
        },
      }
      const wrapper = mountDrawer({ items: [item], subtotal: 119.8 })
      expect(wrapper.text()).toContain('59,90 / unidade')
      expect(wrapper.text()).toContain('119,80')
    })

    it('renders variant details and emits exact variant line actions', async () => {
      const item = {
        ...buildItem(),
        variant: {
          id: 9, name: 'Azul', color_hex: '#3366FF', price: null, effective_price: '42.50',
          stock_quantity: 4, image: 'https://example.com/azul.jpg', is_active: true, position: 0,
        },
      }
      const wrapper = mountDrawer({ items: [item] })

      expect(wrapper.text()).toContain('Azul')
      expect(wrapper.find('img').attributes('src')).toBe('https://example.com/azul.jpg')

      await wrapper.find('[aria-label="Aumentar quantidade de Combo Executivo - Azul"]').trigger('click')
      await wrapper.find('[aria-label="Remover Combo Executivo - Azul do pedido"]').trigger('click')

      expect(wrapper.emitted('updateQuantity')?.[0]).toEqual([1, 2, 9])
      expect(wrapper.emitted('removeItem')?.[0]).toEqual([1, 9])
    })

    it('keeps the footer totals visible', () => {
      const wrapper = mountDrawer({ subtotal: 42.5, deliveryFee: 5, total: 47.5, customer: buildCustomer({ deliveryMethod: 'delivery' }) })
      const footer = wrapper.get('footer')
      expect(footer.text()).toContain('42,50')
      expect(footer.text()).toContain('47,50')
    })
  })

  describe('details step', () => {
    it('shows guest identity and address fields when there is no profile', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ deliveryMethod: 'delivery' }) })
      await goToDetails(wrapper)

      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="tel"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="email"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="street-address"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="address-level3"]').exists()).toBe(true)
      expect(wrapper.find('input[autocomplete="address-level2"]').exists()).toBe(true)
    })

    it('hides identity and address fields and shows the saved-address hint when the profile is complete', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery' }),
        profile: buildProfile(),
      })
      await goToDetails(wrapper)

      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(false)
      expect(wrapper.find('input[autocomplete="street-address"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Endereço salvo')
      expect(wrapper.text()).toContain('Rua das Flores, 42')
    })

    it('hides identity fields but still shows address fields when the profile has no saved address', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery' }),
        profile: buildProfile({ address: '', neighborhood: '', city: '' }),
      })
      await goToDetails(wrapper)

      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(false)
      expect(wrapper.find('input[autocomplete="street-address"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Ele será salvo no seu perfil para os próximos pedidos.')
    })

    it('requires guest name and phone before allowing submission when there is no profile', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ fullName: '', phone: '' }) })
      await goToDetails(wrapper)

      // Ciclo 8: a corrigible-only block never disables the button -- the
      // shopper needs to be able to click it to discover what's missing.
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()
      // And nothing is shown red before any interaction.
      expect(wrapper.text()).not.toContain('Informe seu nome.')
      expect(wrapper.text()).not.toContain('Informe seu telefone.')

      await submitBtn(wrapper).trigger('click')

      expect(wrapper.emitted('submitOrder')).toBeUndefined()
      expect(wrapper.text()).toContain('Informe seu nome.')
      expect(wrapper.text()).toContain('Informe seu telefone.')
      expect(wrapper.text()).toContain('Revise os campos destacados.')
      expect(document.activeElement).toBe(wrapper.get('input[autocomplete="name"]').element)
    })

    it('requires guest address before submission of a delivery order with no profile', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery', address: '', neighborhood: '', city: '' }),
      })
      await goToDetails(wrapper)

      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()

      await submitBtn(wrapper).trigger('click')

      expect(wrapper.emitted('submitOrder')).toBeUndefined()
      expect(wrapper.text()).toContain('Informe o endereço.')
      expect(wrapper.text()).toContain('Informe o bairro.')
      expect(wrapper.text()).toContain('Informe a cidade.')
      expect(document.activeElement).toBe(wrapper.get('input[autocomplete="street-address"]').element)
    })

    it('reveals a touched-and-blurred field error without needing a submit attempt', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ fullName: '', phone: '' }) })
      await goToDetails(wrapper)

      const nameInput = wrapper.get('input[autocomplete="name"]')
      expect(wrapper.text()).not.toContain('Informe seu nome.')

      await nameInput.trigger('blur')
      expect(wrapper.text()).toContain('Informe seu nome.')
      // The phone field was not touched and no attempt happened yet.
      expect(wrapper.text()).not.toContain('Informe seu telefone.')
      expect(nameInput.attributes('aria-invalid')).toBe('true')
      expect(nameInput.attributes('aria-describedby')).toBe('checkout-field-full-name-error')
    })

    it('removes the field error once the value becomes valid', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ fullName: '', phone: '' }) })
      await goToDetails(wrapper)
      await wrapper.get('input[autocomplete="name"]').trigger('blur')
      expect(wrapper.text()).toContain('Informe seu nome.')

      await wrapper.setProps({ customer: buildCustomer({ fullName: 'Ana Corrigida', phone: '' }) })
      expect(wrapper.text()).not.toContain('Informe seu nome.')
      expect(wrapper.get('input[autocomplete="name"]').attributes('aria-invalid')).toBeUndefined()
    })

    it('never validates a field hidden by the current scenario (profile identity present)', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery' }),
        profile: buildProfile(),
      })
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')

      // Identity fields do not exist in the DOM at all for this scenario --
      // no error can be attached to them, and the attempt must not throw.
      expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Informe seu nome.')
    })

    it('does not require guest address fields for a pickup order with no profile', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'pickup', address: '', neighborhood: '', city: '' }),
      })
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')

      expect(wrapper.emitted('submitOrder')).toHaveLength(1)
      expect(wrapper.text()).not.toContain('Informe o endereço.')
    })

    it('does not require guest fields when a complete profile is present', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery', fullName: '', phone: '', address: '' }),
        profile: buildProfile(),
      })
      await goToDetails(wrapper)
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('still lets the customer choose delivery method, payment method and notes', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      expect(wrapper.text()).toContain('Entrega')
      expect(wrapper.text()).toContain('Pagamento')
      expect(wrapper.text()).toContain('Observacoes')
    })

    it('requires a delivery region when regions exist for a delivery order', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery' }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()

      await submitBtn(wrapper).trigger('click')

      expect(wrapper.emitted('submitOrder')).toBeUndefined()
      expect(wrapper.text()).toContain('Selecione a região de entrega.')
      expect(document.activeElement).toBe(wrapper.get('[data-cy="checkout-field-delivery-region"]').element)
    })

    it('does not require a delivery region when the store has none configured', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery' }),
        deliveryRegions: [],
      })
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')

      expect(wrapper.emitted('submitOrder')).toHaveLength(1)
      expect(wrapper.text()).not.toContain('Selecione a região de entrega.')
    })

    it('allows submitting a delivery order once a region is selected', async () => {
      const wrapper = mountDrawer({
        customer: buildCustomer({ deliveryMethod: 'delivery', deliveryRegionId: 1 }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('emits submitOrder when the submit button is clicked while valid', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')
      expect(wrapper.emitted('submitOrder')).toHaveLength(1)
    })

    it('shows a loading label and stays inert while submitting (no double submit)', async () => {
      const wrapper = mountDrawer({ isSubmitting: true })
      await goToDetails(wrapper)
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined()
      await submitBtn(wrapper).trigger('click')
      expect(wrapper.emitted('submitOrder')).toBeUndefined()
      expect(wrapper.text()).toContain('Registrando pedido...')
    })

    it('emits updateCustomer for notes and guest identity fields on input', async () => {
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      await wrapper.find('textarea').setValue('Sem cebola')
      await wrapper.find('input[autocomplete="name"]').setValue('Joao Convidado')
      await wrapper.find('input[autocomplete="tel"]').setValue('11955554444')

      const emitted = wrapper.emitted('updateCustomer') ?? []
      expect(emitted).toContainEqual([{ notes: 'Sem cebola' }])
      expect(emitted).toContainEqual([{ fullName: 'Joao Convidado' }])
      expect(emitted).toContainEqual([{ phone: '11955554444' }])
    })

    it('does not disable the final button for a merely corrigible block (invariant)', async () => {
      // The button may only be disabled by a *structural* reason. This
      // asserts that invariant directly against the same items[]/customer
      // combinations already covered above, so a future change can't
      // silently reintroduce a corrigible-field disable.
      const scenarios: Array<Partial<InstanceType<typeof CartDrawer>['$props']>> = [
        { customer: buildCustomer({ fullName: '', phone: '' }) },
        { customer: buildCustomer({ deliveryMethod: 'delivery', address: '', neighborhood: '', city: '' }) },
        { customer: buildCustomer({ deliveryMethod: 'delivery' }), deliveryRegions: [buildRegion()] },
      ]

      for (const scenario of scenarios) {
        const wrapper = mountDrawer(scenario)
        await goToDetails(wrapper)
        expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()
      }
    })

    it('still disables the final button for a structural block that appears after reaching details', async () => {
      // Stock overflow and "no WhatsApp" already block "Continuar" itself
      // (covered under "step flow"), so the only way to observe them on
      // 'details' is the state changing *after* the step change.
      const wrapper = mountDrawer()
      await goToDetails(wrapper)
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()

      await wrapper.setProps({ isWhatsAppConfigured: false })
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined()
    })

    it('derives the aggregate block, every per-field error and the focus order from the same source', async () => {
      // Five fields invalid at once (guest identity + no saved address),
      // delivery with a configurable region left unselected. If the
      // aggregate gate, the per-field messages and "which field gets focus"
      // were three independent representations, it would be easy for them to
      // disagree (e.g. the aggregate saying "valid" while a field still
      // shows red, or focus landing on a field with no visible error). This
      // asserts all three agree, in the same visual order, from one attempt.
      const wrapper = mountDrawer({
        customer: buildCustomer({
          deliveryMethod: 'delivery',
          fullName: '',
          phone: '',
          deliveryRegionId: null,
          address: '',
          neighborhood: '',
          city: '',
        }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)

      // 1. The aggregate gate (button not disabled -- purely structural
      //    reasons may disable it, and there are none here).
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined()

      await submitBtn(wrapper).trigger('click')

      // 2. The aggregate gate blocked the actual submission.
      expect(wrapper.emitted('submitOrder')).toBeUndefined()

      // 3. Every applicable field shows its own message, all at once.
      expect(wrapper.text()).toContain('Informe seu nome.')
      expect(wrapper.text()).toContain('Informe seu telefone.')
      expect(wrapper.text()).toContain('Selecione a região de entrega.')
      expect(wrapper.text()).toContain('Informe o endereço.')
      expect(wrapper.text()).toContain('Informe o bairro.')
      expect(wrapper.text()).toContain('Informe a cidade.')

      // 4. Focus lands on the *first* of those fields in visual order
      //    (identity block renders above the delivery/region/address block).
      expect(document.activeElement).toBe(wrapper.get('input[autocomplete="name"]').element)

      // 5. Fixing every field (in the same source) clears every message and
      //    unblocks the exact same click path -- no separate reset needed.
      await wrapper.setProps({
        customer: buildCustomer({
          deliveryMethod: 'delivery',
          fullName: 'Cliente Completo',
          phone: '11999990000',
          deliveryRegionId: 1,
          address: 'Rua Corrigida, 1',
          neighborhood: 'Bairro Corrigido',
          city: 'Cidade Corrigida',
        }),
        deliveryRegions: [buildRegion()],
      })
      expect(wrapper.text()).not.toContain('Informe seu nome.')
      expect(wrapper.text()).not.toContain('Selecione a região de entrega.')
      await submitBtn(wrapper).trigger('click')
      expect(wrapper.emitted('submitOrder')).toHaveLength(1)
    })

    it('shows only Total in the footer and Produtos/Frete in the body summary', async () => {
      const wrapper = mountDrawer({
        subtotal: 42.5,
        deliveryFee: 5,
        total: 47.5,
        customer: buildCustomer({ deliveryMethod: 'delivery', deliveryRegionId: 1 }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)

      const footer = wrapper.get('footer')
      expect(footer.text()).toContain('Total')
      expect(footer.text()).toContain('47,50')
      expect(footer.text()).not.toContain('Produtos')
      expect(footer.text()).not.toContain('Frete')

      const summary = wrapper.get('[data-cy="checkout-summary"]')
      expect(summary.text()).toContain('Produtos')
      expect(summary.text()).toContain('42,50')
      expect(summary.text()).toContain('Frete')
      expect(summary.text()).toContain('5,00')
    })

    it('shows "A calcular" in the body summary when delivery is selected but no region is chosen yet', async () => {
      const wrapper = mountDrawer({
        deliveryFee: 0,
        customer: buildCustomer({ deliveryMethod: 'delivery', deliveryRegionId: null }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)

      const summary = wrapper.get('[data-cy="checkout-summary"]')
      expect(summary.text()).toContain('Frete')
      expect(summary.text()).toContain('A calcular')
    })

    it('hides the Frete row in the body summary for pickup', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ deliveryMethod: 'pickup' }) })
      await goToDetails(wrapper)

      const summary = wrapper.get('[data-cy="checkout-summary"]')
      expect(summary.text()).not.toContain('Frete')
    })

    it('updates the body summary reactively when the delivery region changes (no local snapshot)', async () => {
      const wrapper = mountDrawer({
        deliveryFee: 0,
        customer: buildCustomer({ deliveryMethod: 'delivery', deliveryRegionId: null }),
        deliveryRegions: [buildRegion()],
      })
      await goToDetails(wrapper)
      expect(wrapper.get('[data-cy="checkout-summary"]').text()).toContain('A calcular')

      await wrapper.setProps({
        customer: buildCustomer({ deliveryMethod: 'delivery', deliveryRegionId: 1 }),
        deliveryFee: 12,
      })

      const summary = wrapper.get('[data-cy="checkout-summary"]')
      expect(summary.text()).toContain('12,00')
      expect(summary.text()).not.toContain('A calcular')
    })

    it('keeps the retry attempt banner and touched errors after a failed submit', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ fullName: '', phone: '' }) })
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')
      expect(wrapper.text()).toContain('Revise os campos destacados.')

      // A network/server failure surfaces via isSubmitting flipping back to
      // false without the parent closing the drawer or resetting the step --
      // that must not wipe the validation state or the typed data.
      await wrapper.setProps({ isSubmitting: true })
      await wrapper.setProps({ isSubmitting: false })

      expect(wrapper.text()).toContain('Informe seu nome.')
      expect(wrapper.find('[data-cy="checkout-submit-button"]').exists()).toBe(true)
    })

    it('clears validation state on a fresh session but not on a same-session back-and-forth', async () => {
      const wrapper = mountDrawer({ customer: buildCustomer({ fullName: '', phone: '' }) })
      await goToDetails(wrapper)
      await submitBtn(wrapper).trigger('click')
      expect(wrapper.text()).toContain('Informe seu nome.')

      // Same session: going back to review and forward again keeps the
      // already-revealed error (the shopper already tried once).
      await wrapper.get('[aria-label="Voltar ao pedido"]').trigger('click')
      await goToDetails(wrapper)
      expect(wrapper.text()).toContain('Informe seu nome.')

      // A fresh session (drawer closes, cart empties) must not open the
      // next order already covered in red.
      await wrapper.setProps({ items: [], itemCount: 0 })
      await wrapper.setProps({ items: [buildItem()], itemCount: 1 })
      await wrapper.setProps({ isOpen: false })
      await wrapper.setProps({ isOpen: true })
      await goToDetails(wrapper)
      expect(wrapper.text()).not.toContain('Informe seu nome.')
    })
  })
})
