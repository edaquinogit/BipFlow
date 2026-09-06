import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontSkeleton from '../StorefrontSkeleton.vue'

describe('StorefrontSkeleton', () => {
  it('is decorative (aria-hidden) so screen readers ignore it', () => {
    const wrapper = mount(StorefrontSkeleton)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('reserves the requested box so nothing reflows when content lands', () => {
    const wrapper = mount(StorefrontSkeleton, {
      props: { width: '10rem', height: '2.5rem' },
    })
    const style = wrapper.attributes('style') ?? ''
    expect(style).toContain('width: 10rem')
    expect(style).toContain('height: 2.5rem')
  })

  it('renders a circle with a pill radius', () => {
    const wrapper = mount(StorefrontSkeleton, { props: { variant: 'circle' } })
    expect(wrapper.attributes('style')).toContain('border-radius: 9999px')
  })

  it('maps radius presets onto the store radius tokens', () => {
    const wrapper = mount(StorefrontSkeleton, { props: { radius: 'lg' } })
    expect(wrapper.attributes('style')).toContain('--store-radius-lg')
  })
})
