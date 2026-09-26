import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PdvCameraScannerModal from '../PdvCameraScannerModal.vue'

vi.mock('@/composables/usePdvCameraScanner', () => ({
  usePdvCameraScanner: vi.fn(),
}))

import { usePdvCameraScanner } from '@/composables/usePdvCameraScanner'
import { ref, computed } from 'vue'

function buildScannerMock(overrides: Partial<ReturnType<typeof usePdvCameraScanner>> = {}) {
  return {
    isActive: ref(false),
    error: ref(null),
    cameras: ref([]),
    activeCameraId: ref(null),
    hasMultipleCameras: computed(() => false),
    hasTorch: ref(false),
    isTorchOn: ref(false),
    slowHint: ref(false),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    switchCamera: vi.fn().mockResolvedValue(undefined),
    toggleTorch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ReturnType<typeof usePdvCameraScanner>
}

const mountModal = (props: Partial<{ show: boolean; feedback: { type: 'success' | 'error'; message: string } | null }> = {}) =>
  mount(PdvCameraScannerModal, {
    props: { show: true, feedback: null, ...props },
    global: { stubs: { teleport: true } },
  })

describe('PdvCameraScannerModal (Etapa C2 of the PDV camera-scanner evolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when show is false', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(buildScannerMock())
    const wrapper = mountModal({ show: false })

    expect(wrapper.find('[data-cy="pdv-camera-scanner"]').exists()).toBe(false)
  })

  it('starts the camera once shown', async () => {
    const scanner = buildScannerMock()
    vi.mocked(usePdvCameraScanner).mockReturnValue(scanner)

    mountModal({ show: true })
    await flushPromises()

    expect(scanner.start).toHaveBeenCalledTimes(1)
  })

  it('shows the composable error message when the camera fails to start', () => {
    const scanner = buildScannerMock({
      error: ref({ reason: 'permission-denied', message: 'Permissão de câmera negada.' }) as any,
    })
    vi.mocked(usePdvCameraScanner).mockReturnValue(scanner)

    const wrapper = mountModal()

    expect(wrapper.find('[data-cy="pdv-camera-error"]').text()).toBe('Permissão de câmera negada.')
  })

  it('shows the parent-provided feedback after a decode when there is no error', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(buildScannerMock())

    const wrapper = mountModal({ feedback: { type: 'success', message: '"Coxinha" adicionado ao carrinho.' } })

    expect(wrapper.find('[data-cy="pdv-camera-feedback"]').text()).toBe(
      '"Coxinha" adicionado ao carrinho.'
    )
  })

  it('emits decode with the raw scanned text and vibrates', async () => {
    let capturedOnDecode: ((rawText: string) => void) | undefined
    vi.mocked(usePdvCameraScanner).mockImplementation((_videoRef, onDecode) => {
      capturedOnDecode = onDecode
      return buildScannerMock()
    })
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true })

    const wrapper = mountModal()
    capturedOnDecode?.('https://app.bipflow.com/l/loja/p/ABC123')

    expect(wrapper.emitted('decode')).toEqual([['https://app.bipflow.com/l/loja/p/ABC123']])
    expect(navigator.vibrate).toHaveBeenCalledWith(80)
  })

  it('stops the camera and emits close when the close button is clicked', async () => {
    const scanner = buildScannerMock()
    vi.mocked(usePdvCameraScanner).mockReturnValue(scanner)

    const wrapper = mountModal()
    await wrapper.find('[data-cy="pdv-camera-close"]').trigger('click')

    expect(scanner.stop).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows a "switch camera" button only when there is more than one camera', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(
      buildScannerMock({ hasMultipleCameras: computed(() => true) })
    )

    const wrapper = mountModal()

    expect(wrapper.find('[data-cy="pdv-camera-switch"]').exists()).toBe(true)
  })

  it('does not show a "switch camera" button with a single camera', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(buildScannerMock())

    const wrapper = mountModal()

    expect(wrapper.find('[data-cy="pdv-camera-switch"]').exists()).toBe(false)
  })

  it('shows a torch button only when the device reports a flash, and toggles it', async () => {
    const withoutTorch = mountModal()
    expect(withoutTorch.find('[data-cy="pdv-camera-torch"]').exists()).toBe(false)

    const scanner = buildScannerMock({ hasTorch: ref(true) as any })
    vi.mocked(usePdvCameraScanner).mockReturnValue(scanner)
    const withTorch = mountModal()

    const button = withTorch.find('[data-cy="pdv-camera-torch"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(scanner.toggleTorch).toHaveBeenCalledTimes(1)
  })

  it('shows the slow-read hint only when the composable raises it and there is no error', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(
      buildScannerMock({ slowHint: ref(true) as any })
    )

    const wrapper = mountModal()

    expect(wrapper.find('[data-cy="pdv-camera-slow-hint"]').exists()).toBe(true)
    expect(wrapper.find('[data-cy="pdv-camera-slow-hint"]').text()).toContain('busca por nome')
  })

  it('hides the slow-read hint while an error is shown', () => {
    vi.mocked(usePdvCameraScanner).mockReturnValue(
      buildScannerMock({
        slowHint: ref(true) as any,
        error: ref({ reason: 'unknown', message: 'Falhou.' }) as any,
      })
    )

    const wrapper = mountModal()

    expect(wrapper.find('[data-cy="pdv-camera-slow-hint"]').exists()).toBe(false)
    expect(wrapper.find('[data-cy="pdv-camera-error"]').exists()).toBe(true)
  })
})
