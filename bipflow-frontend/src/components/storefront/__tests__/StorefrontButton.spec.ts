import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontButton from '../StorefrontButton.vue'

describe('StorefrontButton', () => {
  it('renders a native button with the requested type and slot content', () => {
    const wrapper = mount(StorefrontButton, {
      props: { type: 'submit' },
      slots: { default: 'Adicionar ao pedido' },
    })
    const button = wrapper.find('button')
    expect(button.attributes('type')).toBe('submit')
    expect(button.text()).toContain('Adicionar ao pedido')
  })

  it('disables and marks itself busy while loading, keeping the label in flow', () => {
    const wrapper = mount(StorefrontButton, {
      props: { loading: true },
      slots: { default: 'Enviar' },
    })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    // Label stays rendered (width stability) but is visually hidden.
    expect(button.text()).toContain('Enviar')
    expect(wrapper.find('.invisible').exists()).toBe(true)
    expect(wrapper.find('.sr-only').text()).toBe('Carregando')
  })

  it('is inert and flagged when disabled', () => {
    const wrapper = mount(StorefrontButton, { props: { disabled: true } })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-disabled')).toBe('true')
  })

  it('does not emit click while loading', async () => {
    const wrapper = mount(StorefrontButton, { props: { loading: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('exposes a focus() method', () => {
    const wrapper = mount(StorefrontButton, { attachTo: document.body })
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.find('button').element)
    wrapper.unmount()
  })

  it('applies the variant class', () => {
    const wrapper = mount(StorefrontButton, { props: { variant: 'outline' } })
    expect(wrapper.find('button').classes()).toContain('storefront-btn--outline')
  })
})
