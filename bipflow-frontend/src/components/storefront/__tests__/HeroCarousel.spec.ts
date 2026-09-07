import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import HeroCarousel from '../HeroCarousel.vue';
import type { PublicStorefrontBanner } from '@/types/store';

function buildBanner(overrides: Partial<PublicStorefrontBanner> = {}): PublicStorefrontBanner {
  return {
    placement: 'hero',
    image_url: 'https://cdn.example.com/hero.png',
    image_url_mobile: '',
    alt_text: 'Colecao verao',
    title: '',
    subtitle: '',
    cta_text: '',
    button_url: '',
    position: 0,
    status: 'active',
    ...overrides,
  };
}

describe('HeroCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are zero banners', () => {
    const wrapper = mount(HeroCarousel, { props: { banners: [], storeName: 'Loja' } });
    expect(wrapper.find('[data-cy="storefront-hero-banner"]').exists()).toBe(false);
  });

  it('renders a single banner with no dots or autoplay announcement', () => {
    const wrapper = mount(HeroCarousel, {
      props: { banners: [buildBanner()], storeName: 'Loja' },
    });

    expect(wrapper.find('[data-cy="storefront-hero-banner"]').exists()).toBe(true);
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('avancando automaticamente');
  });

  it('shows one dot per banner and marks the active one when there are 2+', () => {
    const wrapper = mount(HeroCarousel, {
      props: {
        banners: [buildBanner({ image_url: 'a.png' }), buildBanner({ image_url: 'b.png' })],
        storeName: 'Loja',
      },
    });

    const dots = wrapper.findAll('[role="tab"]');
    expect(dots).toHaveLength(2);
    expect(dots[0]!.attributes('aria-selected')).toBe('true');
    expect(dots[1]!.attributes('aria-selected')).toBe('false');
  });

  it('advances automatically and clicking a dot jumps directly to that slide', async () => {
    const wrapper = mount(HeroCarousel, {
      props: {
        banners: [
          buildBanner({ image_url: 'a.png', title: 'Primeiro' }),
          buildBanner({ image_url: 'b.png', title: 'Segundo' }),
          buildBanner({ image_url: 'c.png', title: 'Terceiro' }),
        ],
        storeName: 'Loja',
      },
    });

    expect(wrapper.text()).toContain('Primeiro');
    await vi.advanceTimersByTimeAsync(6000);
    expect(wrapper.text()).toContain('Segundo');

    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    expect(wrapper.text()).toContain('Terceiro');
  });

  it('pauses autoplay on hover and resumes on mouse leave', async () => {
    const wrapper = mount(HeroCarousel, {
      props: {
        banners: [buildBanner({ title: 'Primeiro' }), buildBanner({ title: 'Segundo' })],
        storeName: 'Loja',
      },
    });

    await wrapper.get('[data-cy="storefront-hero-banner"]').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(10000);
    expect(wrapper.text()).toContain('Primeiro');

    await wrapper.get('[data-cy="storefront-hero-banner"]').trigger('mouseleave');
    await vi.advanceTimersByTimeAsync(6000);
    expect(wrapper.text()).toContain('Segundo');
  });

  it('does not link a banner without a button_url, but does for one with it', () => {
    const wrapper = mount(HeroCarousel, {
      props: { banners: [buildBanner({ button_url: '' })], storeName: 'Loja' },
    });
    expect(wrapper.find('a').exists()).toBe(false);

    const linked = mount(HeroCarousel, {
      props: { banners: [buildBanner({ button_url: '/l/loja/produtos' })], storeName: 'Loja' },
    });
    expect(linked.get('a').attributes('href')).toBe('/l/loja/produtos');
  });
});
