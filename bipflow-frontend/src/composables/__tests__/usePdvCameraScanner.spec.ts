import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { usePdvCameraScanner } from '../usePdvCameraScanner'
import QrScanner from 'qr-scanner'
import { Logger } from '@/services/logger'

/**
 * Etapa C2 of the PDV camera-scanner evolution + the PDV/QR/payment
 * evolution's capture-quality/observability rework. `qr-scanner` talks to
 * real camera hardware (getUserMedia) -- not simulable in jsdom -- so this
 * mocks the library entirely and only verifies the composable's own logic:
 * secure-context/support/permission gating, mapping start() failures to a
 * typed reason, the decode cooldown, torch capability + toggle, the slow-read
 * hint, and that a decode emits a sanitised timing log (never a payload).
 */
vi.mock('qr-scanner', () => {
  class MockQrScanner {
    static hasCamera = vi.fn()
    static listCameras = vi.fn()
    static instances: MockQrScanner[] = []
    static nextStartImpl: () => Promise<void> = () => Promise.resolve()
    onDecode: (result: { data: string }) => void
    $video = { srcObject: null } as unknown as HTMLVideoElement
    start = vi.fn(() => MockQrScanner.nextStartImpl())
    stop = vi.fn()
    destroy = vi.fn()
    setCamera = vi.fn().mockResolvedValue(undefined)
    hasFlash = vi.fn().mockResolvedValue(false)
    isFlashOn = vi.fn().mockReturnValue(false)
    toggleFlash = vi.fn().mockResolvedValue(undefined)

    constructor(_video: unknown, onDecode: (result: { data: string }) => void) {
      this.onDecode = onDecode
      MockQrScanner.instances.push(this)
    }
  }
  return { default: MockQrScanner }
})

const MockedQrScanner = QrScanner as unknown as {
  hasCamera: ReturnType<typeof vi.fn>
  listCameras: ReturnType<typeof vi.fn>
  nextStartImpl: () => Promise<void>
  instances: Array<{
    onDecode: (result: { data: string }) => void
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    setCamera: ReturnType<typeof vi.fn>
    hasFlash: ReturnType<typeof vi.fn>
    isFlashOn: ReturnType<typeof vi.fn>
    toggleFlash: ReturnType<typeof vi.fn>
  }>
}

const wrappers: Array<ReturnType<typeof mount>> = []

const mountScanner = (onDecode: (rawText: string) => void) => {
  const HostComponent = defineComponent({
    setup(_props, { expose }) {
      const videoRef = ref<HTMLVideoElement | null>(null)
      const scanner = usePdvCameraScanner(videoRef, onDecode)
      expose(scanner)
      return () => h('video', { ref: videoRef })
    },
  })
  const wrapper = mount(HostComponent)
  wrappers.push(wrapper)
  return wrapper
}

describe('usePdvCameraScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockedQrScanner.instances.length = 0
    MockedQrScanner.hasCamera.mockResolvedValue(true)
    MockedQrScanner.listCameras.mockResolvedValue([])
    MockedQrScanner.nextStartImpl = () => Promise.resolve()
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    })
  })

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.useRealTimers()
  })

  it('surfaces an insecure-context error and never touches the camera', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()

    expect((wrapper.vm as any).error.reason).toBe('insecure-context')
    expect(MockedQrScanner.hasCamera).not.toHaveBeenCalled()
  })

  it('surfaces a not-supported error when getUserMedia does not exist', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()

    expect((wrapper.vm as any).error.reason).toBe('not-supported')
  })

  it('surfaces a no-camera error when the device has no camera', async () => {
    MockedQrScanner.hasCamera.mockResolvedValue(false)
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()

    expect((wrapper.vm as any).error.reason).toBe('no-camera')
  })

  it('maps a NotAllowedError from scanner.start() to permission-denied', async () => {
    MockedQrScanner.nextStartImpl = () =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'))
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()

    expect((wrapper.vm as any).error.reason).toBe('permission-denied')
    expect(MockedQrScanner.instances[0]!.destroy).toHaveBeenCalledTimes(1)
  })

  it('maps a NotFoundError from scanner.start() to no-camera', async () => {
    MockedQrScanner.nextStartImpl = () =>
      Promise.reject(new DOMException('none', 'NotFoundError'))
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()

    expect((wrapper.vm as any).error.reason).toBe('no-camera')
  })

  it('starts the camera and forwards a decoded code to onDecode', async () => {
    const onDecode = vi.fn()
    const wrapper = mountScanner(onDecode)

    await (wrapper.vm as any).start()
    expect((wrapper.vm as any).isActive).toBe(true)

    const instance = MockedQrScanner.instances[0]!
    instance.onDecode({ data: 'https://bipflow.pages.dev/l/loja/p/ABC123' })

    expect(onDecode).toHaveBeenCalledWith('https://bipflow.pages.dev/l/loja/p/ABC123')
  })

  it('logs sanitised decode timing -- never the decoded payload', async () => {
    const infoSpy = vi.spyOn(Logger, 'info')
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()
    MockedQrScanner.instances[0]!.onDecode({ data: 'SECRET-CODE-XYZ' })

    const decodeLog = infoSpy.mock.calls.find(([msg]) => msg === 'pdv.qr.decode_succeeded')
    expect(decodeLog).toBeDefined()
    const context = JSON.stringify(decodeLog?.[1] ?? {})
    expect(context).not.toContain('SECRET-CODE-XYZ')
    expect(decodeLog?.[1]).toHaveProperty('sinceReadyMs')
  })

  it('ignores repeated decodes within the cooldown window, but accepts the next one after it', async () => {
    vi.useFakeTimers()
    const onDecode = vi.fn()
    const wrapper = mountScanner(onDecode)

    await (wrapper.vm as any).start()
    const instance = MockedQrScanner.instances[0]!

    instance.onDecode({ data: 'CODE1' })
    instance.onDecode({ data: 'CODE1' })
    instance.onDecode({ data: 'CODE1' })
    expect(onDecode).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1300)
    instance.onDecode({ data: 'CODE1' })
    expect(onDecode).toHaveBeenCalledTimes(2)
  })

  it('raises slowHint when no decode arrives within the hint window, and clears it on a decode', async () => {
    vi.useFakeTimers()
    const wrapper = mountScanner(vi.fn())

    await (wrapper.vm as any).start()
    expect((wrapper.vm as any).slowHint).toBe(false)

    vi.advanceTimersByTime(6001)
    expect((wrapper.vm as any).slowHint).toBe(true)

    MockedQrScanner.instances[0]!.onDecode({ data: 'CODE1' })
    expect((wrapper.vm as any).slowHint).toBe(false)
  })

  it('exposes a torch toggle only when the device reports a flash', async () => {
    MockedQrScanner.instances // noop to satisfy lint on ordering
    const wrapper = mountScanner(vi.fn())

    // No flash -> not exposed.
    await (wrapper.vm as any).start()
    expect((wrapper.vm as any).hasTorch).toBe(false)
    ;(wrapper.vm as any).stop()

    // Flash present -> exposed, and toggle flips state.
    const instanceFlash = { on: false }
    MockedQrScanner.instances.length = 0
    const wrapper2 = mountScanner(vi.fn())
    await (wrapper2.vm as any).start()
    const instance = MockedQrScanner.instances[0]!
    instance.hasFlash.mockResolvedValue(true)
    instance.isFlashOn.mockImplementation(() => instanceFlash.on)
    instance.toggleFlash.mockImplementation(async () => {
      instanceFlash.on = !instanceFlash.on
    })
    // re-run capability probe via a camera switch (cheap hook that calls it)
    await (wrapper2.vm as any).switchCamera('cam-1')
    expect((wrapper2.vm as any).hasTorch).toBe(true)

    await (wrapper2.vm as any).toggleTorch()
    expect(instance.toggleFlash).toHaveBeenCalled()
    expect((wrapper2.vm as any).isTorchOn).toBe(true)
  })

  it('stop() releases the camera and resets isActive', async () => {
    const wrapper = mountScanner(vi.fn())
    await (wrapper.vm as any).start()
    const instance = MockedQrScanner.instances[0]!

    ;(wrapper.vm as any).stop()

    expect(instance.stop).toHaveBeenCalledTimes(1)
    expect(instance.destroy).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).isActive).toBe(false)
  })

  it('switchCamera() calls setCamera on the active scanner instance', async () => {
    const wrapper = mountScanner(vi.fn())
    await (wrapper.vm as any).start()
    const instance = MockedQrScanner.instances[0]!

    await (wrapper.vm as any).switchCamera('camera-2')

    expect(instance.setCamera).toHaveBeenCalledWith('camera-2')
    expect((wrapper.vm as any).activeCameraId).toBe('camera-2')
  })

  it('tears down the previous scanner when start() is called again (one stream only)', async () => {
    const wrapper = mountScanner(vi.fn())
    await (wrapper.vm as any).start()
    const first = MockedQrScanner.instances[0]!

    await (wrapper.vm as any).start()

    expect(first.stop).toHaveBeenCalled()
    expect(first.destroy).toHaveBeenCalled()
    expect(MockedQrScanner.instances).toHaveLength(2)
    expect((wrapper.vm as any).isActive).toBe(true)
  })

  it('discards a scanner whose start() resolves after stop() -- no leaked stream', async () => {
    let resolveStart: () => void = () => {}
    MockedQrScanner.nextStartImpl = () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve
      })
    const wrapper = mountScanner(vi.fn())

    const startPromise = (wrapper.vm as any).start()
    // Let hasCamera() resolve so the QrScanner instance is actually built,
    // then close the scanner while instance.start() (getUserMedia) is pending.
    await Promise.resolve()
    await Promise.resolve()
    expect(MockedQrScanner.instances).toHaveLength(1)

    ;(wrapper.vm as any).stop()
    resolveStart()
    await startPromise

    const instance = MockedQrScanner.instances[0]!
    expect(instance.stop).toHaveBeenCalled()
    expect(instance.destroy).toHaveBeenCalled()
    expect((wrapper.vm as any).isActive).toBe(false)
    expect((wrapper.vm as any).error).toBeNull()
  })
})
