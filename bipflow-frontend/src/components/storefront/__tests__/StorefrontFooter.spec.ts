import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontFooter from '../StorefrontFooter.vue'

const mountFooter = (props: Record<string, unknown>) =>
  mount(StorefrontFooter, {
    props: props as never,
    slots: { feedback: '<button data-test="feedback">Fale com a gente</button>' },
  })

describe('StorefrontFooter', () => {
  it('always shows the store name and the feedback slot', () => {
    const wrapper = mountFooter({ storeName: 'Boutique Fitness' })
    expect(wrapper.find('footer').text()).toContain('Boutique Fitness')
    expect(wrapper.find('[data-test="feedback"]').exists()).toBe(true)
  })

  it('shows the tagline only when provided', () => {
    expect(mountFooter({ storeName: 'X' }).text()).not.toContain('undefined')
    const wrapper = mountFooter({ storeName: 'X', tagline: 'Moda fitness com curadoria' })
    expect(wrapper.text()).toContain('Moda fitness com curadoria')
  })

  it('composes city and state from the public merchant profile', () => {
    const wrapper = mountFooter({
      storeName: 'X',
      merchant: { city: 'Salvador', state: 'BA', trade_name: '', website_url: '', instagram_url: '', facebook_url: '', tiktok_url: '', youtube_url: '' },
    })
    expect(wrapper.text()).toContain('Salvador, BA')
  })

  it('renders no location line when the merchant has no address', () => {
    const wrapper = mountFooter({ storeName: 'X', merchant: null })
    expect(wrapper.text().replace(/\s+/g, ' ').trim()).not.toMatch(/,\s*$/)
  })

  it('only renders validated http(s) links from the merchant profile', () => {
    const wrapper = mountFooter({
      storeName: 'X',
      merchant: {
        city: '', state: '', trade_name: '',
        website_url: 'https://loja.com',
        instagram_url: 'javascript:alert(1)',
        facebook_url: '', tiktok_url: '', youtube_url: '',
      },
    })
    const links = wrapper.findAll('a')
    expect(links).toHaveLength(1)
    const link = links[0]!
    expect(link.attributes('href')).toBe('https://loja.com')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })
})
