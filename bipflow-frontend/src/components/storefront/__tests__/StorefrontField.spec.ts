import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontField from '../StorefrontField.vue'

describe('StorefrontField', () => {
  it('associates the label with the input and keeps 16px text (no mobile auto-zoom)', () => {
    const wrapper = mount(StorefrontField, {
      props: { label: 'Nome completo', modelValue: '' },
    })
    const input = wrapper.find('input')
    const label = wrapper.find('label')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(input.classes().some((c) => c.includes('text-[16px]'))).toBe(true)
  })

  it('emits the raw value on input, preserving trailing spaces', async () => {
    const wrapper = mount(StorefrontField, {
      props: { label: 'Busca', modelValue: '' },
    })
    await wrapper.find('input').setValue('camisa ')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['camisa '])
  })

  it('wires aria-invalid and aria-describedby to the error message', async () => {
    const wrapper = mount(StorefrontField, {
      props: { label: 'Email', modelValue: 'x', error: 'Email inválido' },
    })
    const input = wrapper.find('input')
    expect(input.attributes('aria-invalid')).toBe('true')
    const describedBy = input.attributes('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(wrapper.find(`#${describedBy}`).text()).toBe('Email inválido')
  })

  it('hides the label visually but keeps it for assistive tech, honouring an explicit aria-label', () => {
    const wrapper = mount(StorefrontField, {
      props: {
        label: 'Buscar produtos',
        hideLabel: true,
        ariaLabel: 'Buscar produtos por nome',
        modelValue: '',
      },
    })
    expect(wrapper.find('label').classes()).toContain('sr-only')
    expect(wrapper.find('input').attributes('aria-label')).toBe('Buscar produtos por nome')
  })

  it('shows the hint only while there is no error', async () => {
    const wrapper = mount(StorefrontField, {
      props: { label: 'CEP', modelValue: '', hint: 'Somente números' },
    })
    expect(wrapper.text()).toContain('Somente números')
    await wrapper.setProps({ error: 'CEP obrigatório' })
    expect(wrapper.text()).not.toContain('Somente números')
    expect(wrapper.text()).toContain('CEP obrigatório')
  })
})
