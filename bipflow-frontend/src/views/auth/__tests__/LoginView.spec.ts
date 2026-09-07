import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from '@/views/auth/LoginView.vue'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  verifyMfa: vi.fn(),
  push: vi.fn(),
  query: {} as Record<string, string>,
}))

vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    template: '<a><slot /></a>',
  },
  useRoute: () => ({ query: mocks.query }),
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/services/auth.service', () => ({
  authService: {
    login: mocks.login,
    verifyMfa: mocks.verifyMfa,
  },
}))

function axiosError(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Object.assign(new Error('request failed'), {
    config: { method: 'post', url: 'auth/token/' },
    response: { status, data, headers },
  })
}

function mountLogin() {
  return mount(LoginView)
}

async function fillCredentials(wrapper: ReturnType<typeof mountLogin>) {
  await wrapper.get('#admin-email').setValue('admin@example.com')
  await wrapper.get('#admin-password').setValue('senha-segura')
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mocks.query).forEach((key) => delete mocks.query[key])
    mocks.login.mockResolvedValue({ access: 'access-token' })
    mocks.verifyMfa.mockResolvedValue(undefined)
  })

  it('keeps empty-field feedback next to the corresponding controls', async () => {
    const wrapper = mountLogin()

    await wrapper.get('form').trigger('submit.prevent')

    expect(wrapper.get('#admin-email').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#admin-password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Informe seu email administrativo.')
    expect(wrapper.text()).toContain('Informe sua senha.')
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it('never exposes the backend detail for invalid credentials', async () => {
    mocks.login.mockRejectedValue(axiosError(401, { detail: 'User account does not exist' }))
    const wrapper = mountLogin()
    await fillCredentials(wrapper)

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    const alert = wrapper.get('[data-cy="login-error"]')
    expect(alert.text()).toContain('Email ou senha inválidos.')
    expect(alert.text()).not.toContain('User account does not exist')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shows the retry window when the API rate-limits authentication', async () => {
    mocks.login.mockRejectedValue(axiosError(429, { detail: 'rate limited' }, { 'retry-after': '120' }))
    const wrapper = mountLogin()
    await fillCredentials(wrapper)

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.get('[data-cy="login-error"]').text()).toContain('Tente novamente em 2 min')
  })

  it('completes MFA with a normalized six-digit code before redirecting', async () => {
    mocks.login.mockResolvedValue({ mfa_required: true, mfa_token: 'mfa-token' })
    const wrapper = mountLogin()
    await fillCredentials(wrapper)

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.find('[data-cy="mfa-verify-form"]').exists()).toBe(true)
    await wrapper.get('#mfa-code').setValue('12a34-56')
    await wrapper.get('[data-cy="mfa-verify-form"]').trigger('submit.prevent')
    await flushPromises()

    expect(mocks.verifyMfa).toHaveBeenCalledWith({
      mfa_token: 'mfa-token',
      code: '123456',
    })
    expect(mocks.push).toHaveBeenCalledWith({ name: 'dashboard.overview' })
  })

  it('explains an expired session without treating it as a credential error', () => {
    mocks.query.reason = 'session_expired'
    const wrapper = mountLogin()

    expect(wrapper.get('[data-cy="session-notice"]').text()).toContain('Sua sessão expirou')
    expect(wrapper.find('[data-cy="login-error"]').exists()).toBe(false)
  })
})
