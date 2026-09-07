import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useMediaQuery } from '../useMediaQuery'

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: '',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return {
    emit: (next: boolean) => {
      mql.matches = next
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent))
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('returns the current match and reacts to changes', async () => {
    const ctl = mockMatchMedia(false)
    let query!: ReturnType<typeof useMediaQuery>

    const wrapper = mount(
      defineComponent({
        setup() {
          query = useMediaQuery('(min-width: 1024px)')
          return () => h('div', query.value ? 'wide' : 'narrow')
        },
      }),
    )

    expect(wrapper.text()).toBe('narrow')
    ctl.emit(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('wide')
  })

  it('cleans up its listener on unmount', () => {
    const ctl = mockMatchMedia(true)
    const wrapper = mount(
      defineComponent({
        setup() {
          useMediaQuery('(min-width: 1024px)')
          return () => h('div')
        },
      }),
    )
    expect(ctl.listenerCount()).toBe(1)
    wrapper.unmount()
    expect(ctl.listenerCount()).toBe(0)
  })

  it('defaults to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    let query!: ReturnType<typeof useMediaQuery>
    mount(
      defineComponent({
        setup() {
          query = useMediaQuery('(min-width: 1024px)')
          return () => h('div')
        },
      }),
    )
    expect(query.value).toBe(false)
  })
})
