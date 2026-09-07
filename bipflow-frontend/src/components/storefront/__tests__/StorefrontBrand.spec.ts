import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontBrand from '../StorefrontBrand.vue'

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : \'#\'"><slot /></a>',
}

const mountBrand = (props: Record<string, unknown>) =>
  mount(StorefrontBrand, {
    props: props as never,
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('StorefrontBrand', () => {
  it('renders the logo with the store name as alt text', () => {
    const wrapper = mountBrand({ name: 'Boutique Fitness', logoUrl: 'https://cdn/logo.png' })
    const img = wrapper.find('img')
    expect(img.attributes('src')).toBe('https://cdn/logo.png')
    expect(img.attributes('alt')).toBe('Boutique Fitness')
    expect(img.attributes('decoding')).toBe('async')
    expect(wrapper.text()).toContain('Boutique Fitness')
  })

  it('falls back to an initials monogram when the logo fails to load', async () => {
    const wrapper = mountBrand({ name: 'Academia Movimento', logoUrl: 'https://cdn/broken.png' })
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('AC')
  })

  it('renders a plain div (not a link) when no route is given', () => {
    const wrapper = mountBrand({ name: 'Loja', logoUrl: null })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('links to the catalog route when `to` is provided', () => {
    const wrapper = mountBrand({ name: 'Loja', to: '/l/loja/produtos' })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('aria-label')).toContain('ir para o catálogo')
  })

  it('keeps the name available to assistive tech even when visually hidden', () => {
    const wrapper = mountBrand({ name: 'Loja', hideName: true })
    const nameEl = wrapper.findAll('span').find((s) => s.text() === 'Loja')
    expect(nameEl?.classes()).toContain('sr-only')
  })
})
