import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthBrandMark from '@/components/auth/AuthBrandMark.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'

const brandMarkSource = readFileSync(
  resolve(__dirname, '..', 'AuthBrandMark.vue'),
  'utf8',
)

describe('auth components', () => {
  it('renders the official mark with exactly three decorative bars, fully hidden from AT', () => {
    const wrapper = mount(AuthBrandMark)

    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe('/brand/bipflow-logo-auth.webp')
    expect(img.attributes('alt')).toBe('')

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('data-cy')).toBe('auth-brand-mark')
    expect(wrapper.findAll('.auth-brand-mark__bar')).toHaveLength(3)
  })

  it('uses the animated brand mark in both the desktop panel and the mobile header', () => {
    const wrapper = mount(AuthShell, {
      props: { eyebrow: 'x', title: 'y', description: 'z' },
      slots: { default: '<p>form</p>' },
    })

    // one in the lg brand panel, one in the lg:hidden mobile header
    expect(wrapper.findAllComponents(AuthBrandMark).length).toBe(2)
    // the raw <img> brand references are gone -- only the component renders it
    const brandImgs = wrapper
      .findAll('img')
      .filter((i) => i.attributes('src') === '/brand/bipflow-logo-auth.webp')
    expect(brandImgs.length).toBe(2)
  })

  it('brand mark animates only transform/opacity, 4.6s, staggered, and stops for prefers-reduced-motion', () => {
    // spacing collapses in the compiled output, so match on tokens not whitespace
    const css = brandMarkSource.replace(/\s+/g, ' ')

    expect(css).toMatch(/animation:\s*auth-brand-bar-drift 4\.6s cubic-bezier\(0\.22, ?1, ?0\.36, ?1\) infinite/)
    expect(css).toContain('animation-delay: 0ms')
    expect(css).toContain('animation-delay: 180ms')
    expect(css).toContain('animation-delay: 360ms')

    // the keyframes touch only transform + opacity -- never a box-model prop
    const keyframes = brandMarkSource.slice(
      brandMarkSource.indexOf('@keyframes auth-brand-bar-drift'),
      brandMarkSource.indexOf('@media'),
    )
    expect(keyframes).toMatch(/transform:/)
    expect(keyframes).toMatch(/opacity:/)
    expect(keyframes).not.toMatch(/\b(width|height|margin|padding|top|left|right|bottom|inset)\s*:/)

    const reduced = brandMarkSource.slice(brandMarkSource.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.auth-brand-mark__bar')
    expect(reduced).toMatch(/animation:\s*none/)
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
