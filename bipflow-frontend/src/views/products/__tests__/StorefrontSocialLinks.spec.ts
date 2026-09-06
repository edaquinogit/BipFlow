import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StorefrontSocialLinks from '../StorefrontSocialLinks.vue'
import type { PublicMerchantProfile } from '@/types/store'

function merchant(overrides: Partial<PublicMerchantProfile> = {}): PublicMerchantProfile {
  return {
    trade_name: '',
    city: '',
    state: '',
    website_url: '',
    instagram_url: '',
    facebook_url: '',
    tiktok_url: '',
    youtube_url: '',
    ...overrides,
  }
}

describe('StorefrontSocialLinks', () => {
  it('renders nothing when no links are set', () => {
    const wrapper = mount(StorefrontSocialLinks, { props: { merchant: merchant() } })
    expect(wrapper.find('[data-cy="storefront-social-links"]').exists()).toBe(false)
  })

  it('renders nothing when merchant is null', () => {
    const wrapper = mount(StorefrontSocialLinks, { props: { merchant: null } })
    expect(wrapper.find('[data-cy="storefront-social-links"]').exists()).toBe(false)
  })

  it('renders only the http(s) links, opening them safely in a new tab', () => {
    const wrapper = mount(StorefrontSocialLinks, {
      props: {
        merchant: merchant({
          website_url: 'https://minhaloja.com.br',
          instagram_url: 'https://instagram.com/minhaloja',
          facebook_url: 'ftp://not-rendered',
          tiktok_url: '',
        }),
      },
    })

    const links = wrapper.findAll('a')
    expect(links).toHaveLength(2)
    const [first] = links
    expect(first?.attributes('href')).toBe('https://minhaloja.com.br')
    expect(first?.attributes('target')).toBe('_blank')
    expect(first?.attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.text()).not.toContain('ftp://')
  })
})
