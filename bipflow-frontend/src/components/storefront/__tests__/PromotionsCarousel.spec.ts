import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PromotionsCarousel from '../PromotionsCarousel.vue';
import type { PublicStorefrontBanner } from '@/types/store';

function buildPromotion(overrides: Partial<PublicStorefrontBanner> = {}): PublicStorefrontBanner {
  return {
    placement: 'promotion',
    image_url: 'https://cdn.example.com/promo.png',
    image_url_mobile: '',
    alt_text: '',
    title: 'Oferta',
    subtitle: '',
    cta_text: '',
    button_url: '',
    position: 0,
    status: 'active',
    ...overrides,
  };
}

describe('PromotionsCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    // jsdom does not implement Element.prototype.scrollTo.
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = () => {};
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing with zero promotions', () => {
    const wrapper = mount(PromotionsCarousel, { props: { promotions: [] } });
    expect(wrapper.find('[data-cy="storefront-promotional-banners"]').exists()).toBe(false);
  });

  it('never wraps into a grid: cards live in a single scrollable row', () => {
    const wrapper = mount(PromotionsCarousel, {
      props: { promotions: [buildPromotion(), buildPromotion({ image_url: 'b.png' })] },
    });

    const track = wrapper.get('[role="region"]');
    expect(track.classes()).toContain('flex');
    expect(track.classes()).not.toContain('grid');
    expect(track.classes()).toContain('overflow-x-auto');
  });

  it('hides dots, keyboard focus and the autoplay hint with a single promotion', () => {
    const wrapper = mount(PromotionsCarousel, { props: { promotions: [buildPromotion()] } });

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(wrapper.get('[role="region"]').attributes('tabindex')).toBeUndefined();
  });

  it('never renders visible arrow buttons, even with 2+ promotions', () => {
    const wrapper = mount(PromotionsCarousel, {
      props: {
        promotions: [buildPromotion(), buildPromotion({ image_url: 'b.png' }), buildPromotion({ image_url: 'c.png' })],
      },
    });

    expect(wrapper.find('[data-cy="storefront-promotions-prev"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="storefront-promotions-next"]').exists()).toBe(false);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(3);
    expect(wrapper.get('[role="region"]').attributes('tabindex')).toBe('0');
  });

  it('advances one promotion per right-arrow keypress, looping from the last back to the first', async () => {
    const wrapper = mount(PromotionsCarousel, {
      props: {
        promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' }), buildPromotion({ title: 'C' })],
      },
    });

    const dots = () => wrapper.findAll('[role="tab"]');
    const track = wrapper.get('[role="region"]');
    expect(dots()[0]!.attributes('aria-selected')).toBe('true');

    await track.trigger('keydown', { key: 'ArrowRight' });
    expect(dots()[1]!.attributes('aria-selected')).toBe('true');

    await track.trigger('keydown', { key: 'ArrowRight' });
    await track.trigger('keydown', { key: 'ArrowRight' });
    expect(dots()[0]!.attributes('aria-selected')).toBe('true');
  });

  it('goes back one promotion per left-arrow keypress', async () => {
    const wrapper = mount(PromotionsCarousel, {
      props: { promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' })] },
    });

    const dots = () => wrapper.findAll('[role="tab"]');
    await wrapper.get('[role="region"]').trigger('keydown', { key: 'ArrowLeft' });

    expect(dots()[1]!.attributes('aria-selected')).toBe('true');
  });

  it('lets a click on a dot jump directly to that promotion', async () => {
    const wrapper = mount(PromotionsCarousel, {
      props: {
        promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' }), buildPromotion({ title: 'C' })],
      },
    });

    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');

    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true');
  });

  it('pauses on touch and resumes on touchend', async () => {
    const wrapper = mount(PromotionsCarousel, {
      props: { promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' })] },
    });
    const section = wrapper.get('[data-cy="storefront-promotional-banners"]');

    await section.trigger('touchstart');
    await vi.advanceTimersByTimeAsync(10000);
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true');

    await section.trigger('touchend');
    await vi.advanceTimersByTimeAsync(5000);
    expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true');
  });

  it('does not render a link wrapper for a promotion without a destination', () => {
    const wrapper = mount(PromotionsCarousel, {
      props: { promotions: [buildPromotion({ button_url: '' })] },
    });
    expect(wrapper.find('a').exists()).toBe(false);
  });

  // Scroll-jump regression (Ciclo 9): autoplay advancing the active slide
  // must only ever move the track's own scrollLeft, never window.scrollY --
  // this is exactly what broke a real category-change flow, because
  // `scrollIntoView({ block: 'nearest' })` scrolls the *page* vertically
  // whenever the carousel itself is outside the viewport (e.g. the shopper
  // has scrolled down to the product grid).
  it('never scrolls the window when autoplay advances the active promotion', async () => {
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const trackScrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});

    mount(PromotionsCarousel, {
      props: {
        promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' }), buildPromotion({ title: 'C' })],
      },
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(trackScrollTo).toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it('never calls scrollIntoView (which is not horizontal-only) when centering the active promotion', async () => {
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    const wrapper = mount(PromotionsCarousel, {
      props: { promotions: [buildPromotion({ title: 'A' }), buildPromotion({ title: 'B' })] },
    });

    await wrapper.get('[role="region"]').trigger('keydown', { key: 'ArrowRight' });
    await vi.advanceTimersByTimeAsync(0);

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});
