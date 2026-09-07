import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthBrandMark from '@/components/auth/AuthBrandMark.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'

describe('auth components', () => {
  it('renders the official mark with three independently animated speed lines', () => {
    const wrapper = mount(AuthBrandMark)

    expect(wrapper.get('img').attributes('src')).toBe('/brand/bipflow-logo-auth.webp')
    expect(wrapper.get('[data-cy="auth-brand-mark"]').classes()).toContain('auth-brand-mark--animated')
    expect(wrapper.findAll('.auth-brand-mark__speed-line')).toHaveLength(3)
  })

  it('keeps the mobile authentication task top-aligned with 24px side spacing', () => {
    const wrapper = mount(AuthShell, {
      props: {
        eyebrow: 'Painel administrativo',
        title: 'Sua operação, sob controle total.',
        description: 'Gerencie sua operação.',
      },
      slots: { default: '<form>Entrar</form>' },
    })

    const panel = wrapper.get('.auth-form-panel')
    expect(panel.classes()).toContain('items-start')
    expect(panel.classes()).toContain('lg:items-center')
    expect(panel.classes()).toContain('px-6')
    expect(wrapper.findAll('[data-cy="auth-brand-mark"]')).toHaveLength(2)
  })

  it('connects the field label, error and input accessibility state', async () => {
    const wrapper = mount(AuthField, {
      props: {
        id: 'account-email',
        label: 'Email',
        modelValue: '',
        type: 'email',
        error: 'Informe um email válido.',
      },
    })

    const input = wrapper.get('input')
    expect(wrapper.get('label').attributes('for')).toBe('account-email')
    expect(input.attributes('id')).toBe('account-email')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe('account-email-error')
    expect(wrapper.get('#account-email-error').attributes('role')).toBe('alert')

    await input.setValue('contato@bipflow.com')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['contato@bipflow.com'])
  })

  it('lets the user reveal and hide a password with an accessible control', async () => {
    const wrapper = mount(AuthField, {
      props: {
        id: 'account-password',
        label: 'Senha',
        modelValue: 'segredo',
        type: 'password',
      },
    })

    const input = wrapper.get('input')
    const toggle = wrapper.get('button')
    expect(input.attributes('type')).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('Mostrar senha')

    await toggle.trigger('click')
    expect(input.attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Ocultar senha')
  })

  it('announces critical messages assertively and informational messages politely', () => {
    const error = mount(AuthAlert, {
      props: { tone: 'error' },
      slots: { default: 'Falha ao entrar.' },
    })
    const info = mount(AuthAlert, {
      props: { tone: 'info' },
      slots: { default: 'Sua sessão expirou.' },
    })

    expect(error.attributes('role')).toBe('alert')
    expect(error.attributes('aria-live')).toBe('assertive')
    expect(info.attributes('role')).toBe('status')
    expect(info.attributes('aria-live')).toBe('polite')
  })

  it('blocks repeated submit while loading and keeps a clear label', () => {
    const wrapper = mount(AuthSubmitButton, {
      props: { loading: true, loadingLabel: 'Entrando...' },
      slots: { default: 'Entrar no BipFlow' },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).toContain('Entrando...')
  })
})
