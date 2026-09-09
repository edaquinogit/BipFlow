import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import CommerceSettingsTab from '../CommerceSettingsTab.vue'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect'
import { useToast } from '@/composables/useToast'
import { commerceSettingsService } from '@/services/commerceSettings.service'
import type { CommerceSettings } from '@/schemas/commerceSettings.schema'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const selectedStoreRef = ref<{ id: number; slug: string } | null>(null)

/** Invoke the callback CommerceSettingsTab registered with useStoreSwitchEffect. */
function triggerStoreSwitch(nextStore: { id: number; slug: string }): void {
  selectedStoreRef.value = nextStore
  const call = vi.mocked(useStoreSwitchEffect).mock.calls[0]
  if (!call) {
    throw new Error('useStoreSwitchEffect was not registered by the component')
  }
  ;(call[0] as () => void)()
}

vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/composables/useCurrentUser', () => ({ useCurrentUser: vi.fn() }))
vi.mock('@/composables/useStoreSwitchEffect', () => ({ useStoreSwitchEffect: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: vi.fn() }))
vi.mock('@/services/commerceSettings.service', () => ({
  commerceSettingsService: { get: vi.fn(), update: vi.fn() },
}))

function buildSettings(overrides: Partial<CommerceSettings> = {}): CommerceSettings {
  return {
    orders_enabled: true,
    delivery_enabled: true,
    pickup_enabled: true,
    minimum_order_value: '0.00',
    accepts_pix: true,
    accepts_card: true,
    accepts_cash: true,
    enabled_delivery_methods: ['delivery', 'pickup'],
    enabled_payment_methods: ['pix', 'card', 'cash'],
    ...overrides,
  }
}

describe('CommerceSettingsTab', () => {
  const toastState = { success: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    selectedStoreRef.value = { id: 1, slug: 'loja-a' }
    vi.mocked(useCurrentStore).mockReturnValue({
      selectedStore: selectedStoreRef,
    } as never)
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(true) } as never)
    vi.mocked(useToast).mockReturnValue(toastState as never)
  })

  it('loads the config into the form on mount', async () => {
    vi.mocked(commerceSettingsService.get).mockResolvedValue(
      buildSettings({ minimum_order_value: '30.00', accepts_cash: false }),
    )

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    expect((wrapper.get('[data-cy="commerce-minimum-order-value"]').element as HTMLInputElement).value)
      .toBe('30.00')
    expect((wrapper.get('[data-cy="commerce-accepts-cash"]').element as HTMLInputElement).checked)
      .toBe(false)
  })

  it('blocks saving an invalid combination and shows a hint', async () => {
    vi.mocked(commerceSettingsService.get).mockResolvedValue(buildSettings())

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    await wrapper.get('[data-cy="commerce-delivery-enabled"]').setValue(false)
    await wrapper.get('[data-cy="commerce-pickup-enabled"]').setValue(false)

    expect(wrapper.text()).toContain('habilite entrega ou retirada')
    expect(wrapper.get('[data-cy="commerce-settings-save"]').attributes('disabled')).toBeDefined()
    expect(commerceSettingsService.update).not.toHaveBeenCalled()
  })

  it('saves a valid change and shows a success toast', async () => {
    vi.mocked(commerceSettingsService.get).mockResolvedValue(buildSettings())
    vi.mocked(commerceSettingsService.update).mockResolvedValue(
      buildSettings({ minimum_order_value: '50.00' }),
    )

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    await wrapper.get('[data-cy="commerce-minimum-order-value"]').setValue('50')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(commerceSettingsService.update).toHaveBeenCalledWith(
      expect.objectContaining({ minimum_order_value: '50.00' }),
    )
    expect(toastState.success).toHaveBeenCalledWith('Configurações de vendas atualizadas.')
  })

  it('surfaces a backend 400 error', async () => {
    vi.mocked(commerceSettingsService.get).mockResolvedValue(buildSettings())
    const axiosError = Object.assign(new Error('Request failed'), {
      config: {},
      response: {
        status: 400,
        data: { accepts_pix: ['Aceite ao menos uma forma de pagamento.'] },
      },
    })
    vi.mocked(commerceSettingsService.update).mockRejectedValue(axiosError)

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    await wrapper.get('[data-cy="commerce-minimum-order-value"]').setValue('10')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.get('[data-cy="commerce-settings-backend-error"]').text())
      .toContain('Aceite ao menos uma forma de pagamento.')
  })

  it('viewer sees the form disabled and no save button', async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(false) } as never)
    vi.mocked(commerceSettingsService.get).mockResolvedValue(buildSettings())

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    expect(wrapper.find('[data-cy="commerce-settings-save"]').exists()).toBe(false)
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Você pode visualizar, mas não editar')
  })

  it('shows the load error banner when the fetch fails', async () => {
    vi.mocked(commerceSettingsService.get).mockRejectedValue(new Error('down'))

    const wrapper = mount(CommerceSettingsTab)
    await flushPromises()

    expect(wrapper.get('[data-cy="commerce-settings-load-error"]').text())
      .toContain('Não foi possível carregar as configurações de vendas agora.')
  })

  it('drops a stale GET that resolves after a store switch', async () => {
    const getA = deferred<CommerceSettings>()
    const getB = deferred<CommerceSettings>()
    vi.mocked(commerceSettingsService.get)
      .mockReturnValueOnce(getA.promise)
      .mockReturnValueOnce(getB.promise)

    const wrapper = mount(CommerceSettingsTab)
    // Switch to store B -> a second get() for B.
    triggerStoreSwitch({ id: 2, slug: 'loja-b' })

    getB.resolve(buildSettings({ minimum_order_value: '20.00' }))
    await flushPromises()
    // Store A's slow response lands last but must be ignored.
    getA.resolve(buildSettings({ minimum_order_value: '999.00' }))
    await flushPromises()

    expect((wrapper.get('[data-cy="commerce-minimum-order-value"]').element as HTMLInputElement).value)
      .toBe('20.00')
  })
})
