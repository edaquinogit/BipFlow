import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { isStorefrontOverlayOpen, useStorefrontOverlay } from '../useStorefrontOverlay'

// `ref<boolean>()` with no initial value infers `Ref<boolean | undefined>`
// (that's the overload TypeScript picks for `ReturnType<typeof ref<boolean>>`
// too, since it doesn't know an argument will always be supplied). Every
// call site below always passes an initial boolean (`ref(false)`/`ref(true)`),
// so the real value here is always defined -- annotate the helper with the
// `Ref<boolean>` shape `useStorefrontOverlay` itself expects, instead of
// deriving a looser type from the generic factory.
const host = (isOpen: Ref<boolean>) =>
  mount(
    defineComponent({
      setup() {
        useStorefrontOverlay(isOpen)
        return () => h('div')
      },
    }),
  )

afterEach(() => {
  document.body.style.overflow = ''
})

describe('useStorefrontOverlay', () => {
  it('flips the shared signal and locks body scroll while open', async () => {
    const open = ref(false)
    host(open)
    expect(isStorefrontOverlayOpen.value).toBe(false)

    open.value = true
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    open.value = false
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('stays locked while at least one overlay is open (ref-counted)', async () => {
    const a = ref(true)
    const b = ref(true)
    const wa = host(a)
    host(b)
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(true)

    a.value = false
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(true) // b still open
    expect(document.body.style.overflow).toBe('hidden')

    b.value = false
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(false)

    wa.unmount()
  })

  it('releases its hold when the component unmounts still open', async () => {
    const open = ref(true)
    const wrapper = host(open)
    await Promise.resolve()
    expect(isStorefrontOverlayOpen.value).toBe(true)

    wrapper.unmount()
    expect(isStorefrontOverlayOpen.value).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })
})
