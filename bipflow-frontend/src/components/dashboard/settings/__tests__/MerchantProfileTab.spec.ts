import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import MerchantProfileTab from '../MerchantProfileTab.vue'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { useCurrentStore } from '@/composables/useCurrentStore'
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect'
import { useToast } from '@/composables/useToast'
import { storeService } from '@/services/store.service'
import type { MerchantProfile } from '@/types/store'

vi.mock('@/composables/useCurrentUser', () => ({ useCurrentUser: vi.fn() }))
vi.mock('@/composables/useCurrentStore', () => ({ useCurrentStore: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: vi.fn() }))
vi.mock('@/composables/useStoreSwitchEffect', () => ({ useStoreSwitchEffect: vi.fn() }))
vi.mock('@/services/store.service', () => ({
  storeService: {
    getMerchantProfile: vi.fn(),
    updateMerchantProfile: vi.fn(),
  },
}))

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

const STORE_A = { id: 1, slug: 'loja-a' }
const STORE_B = { id: 2, slug: 'loja-b' }

const selectedStoreRef = ref<{ id: number; slug: string } | null>(null)

/** Invoke the callback `MerchantProfileTab` registered with useStoreSwitchEffect. */
function triggerStoreSwitch(nextStore: { id: number; slug: string }): void {
  selectedStoreRef.value = nextStore
  const call = vi.mocked(useStoreSwitchEffect).mock.calls[0]
  if (!call) {
    throw new Error('useStoreSwitchEffect was not registered by the component')
  }
  ;(call[0] as () => void)()
}

function buildProfile(overrides: Partial<MerchantProfile> = {}): MerchantProfile {
  return {
    legal_name: '',
    trade_name: '',
    tax_id: '',
    contact_email: '',
    contact_phone: '',
    postal_code: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
    country: 'BR',
    website_url: '',
    instagram_url: '',
    facebook_url: '',
    tiktok_url: '',
    youtube_url: '',
    is_complete: false,
    has_complete_address: false,
    created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    ...overrides,
  }
}

describe('MerchantProfileTab', () => {
  const toastState = { success: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    selectedStoreRef.value = { ...STORE_A }
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(true) } as never)
    vi.mocked(useCurrentStore).mockReturnValue({ selectedStore: selectedStoreRef } as never)
    vi.mocked(useToast).mockReturnValue(toastState as never)
  })

  it('hydrates the form from the loaded profile', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(
      buildProfile({ trade_name: 'Boutique X', city: 'Salvador', state: 'BA', is_complete: true }),
    )

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    expect((wrapper.find('[data-cy="merchant-trade-name"]').element as HTMLInputElement).value).toBe('Boutique X')
    expect((wrapper.find('[data-cy="merchant-city"]').element as HTMLInputElement).value).toBe('Salvador')
    expect(wrapper.find('[data-cy="merchant-profile-status"]').text()).toContain('Completo')
  })

  it('keeps the save button disabled until a field changes', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(buildProfile())

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-cy="merchant-trade-name"]').setValue('Nova Loja')

    expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeUndefined()
  })

  it('PATCHes only the changed fields and shows a success toast', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(
      buildProfile({ legal_name: 'ACME LTDA' }),
    )
    vi.mocked(storeService.updateMerchantProfile).mockResolvedValue(
      buildProfile({ legal_name: 'ACME LTDA', trade_name: 'ACME Store' }),
    )

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    await wrapper.find('[data-cy="merchant-trade-name"]').setValue('ACME Store')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(storeService.updateMerchantProfile).toHaveBeenCalledWith({ trade_name: 'ACME Store' })
    expect(toastState.success).toHaveBeenCalledWith('Perfil da loja atualizado.')
  })

  it('flags an invalid e-mail and blocks saving', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(buildProfile())

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    await wrapper.find('[data-cy="merchant-contact-email"]').setValue('not-an-email')

    expect(wrapper.text()).toContain('Informe um e-mail válido.')
    expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeDefined()
  })

  it('warns about a link that does not start with https', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(buildProfile())

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    await wrapper.find('[data-cy="merchant-instagram"]').setValue('javascript:alert(1)')

    expect(wrapper.text()).toContain('Comece com https://')
    expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeDefined()
  })

  it('surfaces per-field server validation errors', async () => {
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(buildProfile())
    vi.mocked(storeService.updateMerchantProfile).mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        config: {},
        response: { status: 400, data: { tax_id: ['CNPJ invalido.'] } },
      }),
    )

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    await wrapper.find('[data-cy="merchant-tax-id"]').setValue('11222333000180')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('CNPJ invalido.')
    expect(wrapper.find('[data-cy="merchant-profile-form-error"]').text()).toContain('Revise os campos destacados')
    expect(toastState.error).toHaveBeenCalled()
  })

  it('shows an error banner when the profile fails to load', async () => {
    vi.mocked(storeService.getMerchantProfile).mockRejectedValue(new Error('network down'))

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    expect(wrapper.find('[data-cy="merchant-profile-load-error"]').text()).toContain(
      'Não foi possível carregar o perfil da loja agora.',
    )
  })

  it('hides the editing form for members without write access', async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ canManageCatalog: ref(false) } as never)
    vi.mocked(storeService.getMerchantProfile).mockResolvedValue(buildProfile({ trade_name: 'Loja Y' }))

    const wrapper = mount(MerchantProfileTab)
    await flushPromises()

    expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('não tem permissão para editá-lo')
  })

  describe('store-switch race safety', () => {
    it('Test A — drops a stale GET success and never renders store A data (incl. PII) on store B', async () => {
      const getA = deferred<MerchantProfile>()
      const getB = deferred<MerchantProfile>()
      vi.mocked(storeService.getMerchantProfile)
        .mockReturnValueOnce(getA.promise as never)
        .mockReturnValueOnce(getB.promise as never)

      const wrapper = mount(MerchantProfileTab) // onMounted -> GET A (store A)
      await flushPromises()

      triggerStoreSwitch(STORE_B) // -> GET B (store B)
      await flushPromises()

      getB.resolve(buildProfile({ legal_name: 'Empresa Tenant B', trade_name: 'B' }))
      await flushPromises()

      getA.resolve(
        buildProfile({
          legal_name: 'Empresa Tenant A',
          tax_id: '11222333000181',
          trade_name: 'A',
        }),
      )
      await flushPromises()

      expect((wrapper.find('[data-cy="merchant-legal-name"]').element as HTMLInputElement).value).toBe(
        'Empresa Tenant B',
      )
      expect(wrapper.html()).not.toContain('Empresa Tenant A')
      expect(wrapper.html()).not.toContain('11222333000181')
    })

    it('Test B — drops a stale GET error so no banner appears on store B', async () => {
      const getA = deferred<MerchantProfile>()
      const getB = deferred<MerchantProfile>()
      vi.mocked(storeService.getMerchantProfile)
        .mockReturnValueOnce(getA.promise as never)
        .mockReturnValueOnce(getB.promise as never)

      const wrapper = mount(MerchantProfileTab)
      await flushPromises()

      triggerStoreSwitch(STORE_B)
      await flushPromises()

      getB.resolve(buildProfile({ legal_name: 'Empresa Tenant B' }))
      await flushPromises()

      getA.reject(new Error('store A network down'))
      await flushPromises()

      expect(wrapper.find('[data-cy="merchant-profile-load-error"]').exists()).toBe(false)
      expect((wrapper.find('[data-cy="merchant-legal-name"]').element as HTMLInputElement).value).toBe(
        'Empresa Tenant B',
      )
    })

    it('Test C — drops a stale PATCH success (no re-hydrate, no success toast on store B)', async () => {
      vi.mocked(storeService.getMerchantProfile)
        .mockResolvedValueOnce(buildProfile({ legal_name: 'Empresa Tenant A', trade_name: 'A' }))
        .mockResolvedValueOnce(buildProfile({ legal_name: 'Empresa Tenant B', trade_name: 'B' }))
      const patchA = deferred<MerchantProfile>()
      vi.mocked(storeService.updateMerchantProfile).mockReturnValueOnce(patchA.promise as never)

      const wrapper = mount(MerchantProfileTab)
      await flushPromises()

      await wrapper.find('[data-cy="merchant-trade-name"]').setValue('Editado na loja A')
      await wrapper.find('form').trigger('submit.prevent') // PATCH A pending
      await flushPromises()

      triggerStoreSwitch(STORE_B)
      await flushPromises() // GET B resolves

      patchA.resolve(buildProfile({ legal_name: 'Empresa Tenant A', trade_name: 'Editado na loja A' }))
      await flushPromises()

      expect((wrapper.find('[data-cy="merchant-legal-name"]').element as HTMLInputElement).value).toBe(
        'Empresa Tenant B',
      )
      expect((wrapper.find('[data-cy="merchant-trade-name"]').element as HTMLInputElement).value).toBe('B')
      expect(wrapper.html()).not.toContain('Empresa Tenant A')
      expect(toastState.success).not.toHaveBeenCalled()
      // store B's form is usable (the pending A save must not leave it disabled)
      await wrapper.find('[data-cy="merchant-trade-name"]').setValue('Editado na loja B')
      expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeUndefined()
    })

    it('Test D — drops a stale PATCH failure so no error surfaces on store B', async () => {
      vi.mocked(storeService.getMerchantProfile)
        .mockResolvedValueOnce(buildProfile({ legal_name: 'Empresa Tenant A' }))
        .mockResolvedValueOnce(buildProfile({ legal_name: 'Empresa Tenant B' }))
      const patchA = deferred<MerchantProfile>()
      vi.mocked(storeService.updateMerchantProfile).mockReturnValueOnce(patchA.promise as never)

      const wrapper = mount(MerchantProfileTab)
      await flushPromises()

      await wrapper.find('[data-cy="merchant-trade-name"]').setValue('X')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      triggerStoreSwitch(STORE_B)
      await flushPromises()

      patchA.reject(
        Object.assign(new Error('Request failed'), {
          config: {},
          response: { status: 400, data: { tax_id: ['CNPJ invalido.'] } },
        }),
      )
      await flushPromises()

      expect(wrapper.find('[data-cy="merchant-profile-form-error"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain('CNPJ invalido.')
      expect(toastState.error).not.toHaveBeenCalled()
    })

    it('Test E — normal flow (no switch): hydrate, save, toast and dirty-clear still work', async () => {
      vi.mocked(storeService.getMerchantProfile).mockResolvedValue(
        buildProfile({ legal_name: 'ACME LTDA' }),
      )
      vi.mocked(storeService.updateMerchantProfile).mockResolvedValue(
        buildProfile({ legal_name: 'ACME LTDA', trade_name: 'ACME Store' }),
      )

      const wrapper = mount(MerchantProfileTab)
      await flushPromises()

      expect((wrapper.find('[data-cy="merchant-legal-name"]').element as HTMLInputElement).value).toBe(
        'ACME LTDA',
      )

      await wrapper.find('[data-cy="merchant-trade-name"]').setValue('ACME Store')
      expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeUndefined()

      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(storeService.updateMerchantProfile).toHaveBeenCalledWith({ trade_name: 'ACME Store' })
      expect(toastState.success).toHaveBeenCalledWith('Perfil da loja atualizado.')
      // baseline replaced -> form no longer dirty
      expect(wrapper.find('[data-cy="btn-save-merchant-profile"]').attributes('disabled')).toBeDefined()
    })
  })
})
