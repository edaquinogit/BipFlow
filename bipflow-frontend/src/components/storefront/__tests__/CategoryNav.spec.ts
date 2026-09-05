import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import CategoryNav from '../CategoryNav.vue';
import type { Category } from '@/schemas/category.schema';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function buildCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: 'Calcas',
    slug: 'calcas',
    ...overrides,
  } as Category;
}

describe('CategoryNav', () => {
  beforeEach(() => {
    mockReducedMotion(false);
    // jsdom does not implement Element.prototype.scrollTo at all (unlike
    // window.scrollTo, which it stubs with a warning) -- give it a no-op so
    // vi.spyOn() has a real function to wrap.
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = () => {};
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no categories', () => {
    const wrapper = mount(CategoryNav, { props: { categories: [], activeCategoryId: undefined } });
    expect(wrapper.find('[data-cy="storefront-category-nav"]').exists()).toBe(false);
  });

  it('always shows "Todos" first, followed by each category', () => {
    const wrapper = mount(CategoryNav, {
      props: {
        categories: [buildCategory({ id: 1, name: 'Calcas' }), buildCategory({ id: 2, name: 'Botas' })],
        activeCategoryId: undefined,
      },
    });

    const labels = wrapper.findAll('button').map((button) => button.text());
    expect(labels).toEqual(['Todos', 'Calcas', 'Botas']);
  });

  it('marks "Todos" as selected when no category is active', () => {
    const wrapper = mount(CategoryNav, {
      props: { categories: [buildCategory()], activeCategoryId: undefined },
    });

    expect(wrapper.get('[data-cy="storefront-category-chip-all"]').attributes('aria-pressed')).toBe('true');
  });

  it('marks the matching category chip as selected', () => {
    const wrapper = mount(CategoryNav, {
      props: {
        categories: [buildCategory({ id: 1 }), buildCategory({ id: 2, name: 'Botas' })],
        activeCategoryId: 2,
      },
    });

    const chips = wrapper.findAll('[data-cy="storefront-category-chip"]');
    expect(chips[0]!.attributes('aria-pressed')).toBe('false');
    expect(chips[1]!.attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-cy="storefront-category-chip-all"]').attributes('aria-pressed')).toBe('false');
  });

  it('emits select(undefined) for "Todos" and select(id) for a category', async () => {
    const wrapper = mount(CategoryNav, {
      props: { categories: [buildCategory({ id: 7, name: 'Acessorios' })], activeCategoryId: 7 },
    });

    await wrapper.get('[data-cy="storefront-category-chip"]').trigger('click');
    expect(wrapper.emitted('select')).toContainEqual([7]);

    await wrapper.get('[data-cy="storefront-category-chip-all"]').trigger('click');
    expect(wrapper.emitted('select')).toContainEqual([undefined]);
  });

  it('gives every chip a comfortable minimum touch target', () => {
    const wrapper = mount(CategoryNav, {
      props: { categories: [buildCategory()], activeCategoryId: undefined },
    });

    // The 44px minimum lives in the shared `.storefront-chip` CSS rule
    // (`min-height: 2.75rem`) rather than a per-component utility class --
    // jsdom doesn't compute real layout, so the actual rendered height is
    // asserted in Cypress (category-scroll-preservation.cy.ts) instead.
    for (const button of wrapper.findAll('button')) {
      expect(button.classes()).toContain('storefront-chip');
    }
  });

  // Scroll-jump regression (Ciclo 9): centering the active chip must only
  // ever move the horizontal track's own scroll position -- never the page.
  describe('active-chip centering touches only horizontal scroll', () => {
    it('scrolls the track element itself, never the window, when the active category changes', async () => {
      const trackScrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
      const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      const wrapper = mount(CategoryNav, {
        props: {
          categories: [buildCategory({ id: 1 }), buildCategory({ id: 2, name: 'Botas' })],
          activeCategoryId: undefined,
        },
      });

      await wrapper.setProps({ activeCategoryId: 2 });
      await flushPromises();

      expect(trackScrollTo).toHaveBeenCalled();
      expect(windowScrollTo).not.toHaveBeenCalled();
    });

    it('never mutates window.scrollY while centering', async () => {
      vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
      const initialScrollY = window.scrollY;

      const wrapper = mount(CategoryNav, {
        props: {
          categories: [buildCategory({ id: 1 }), buildCategory({ id: 2, name: 'Botas' })],
          activeCategoryId: undefined,
        },
      });

      await wrapper.setProps({ activeCategoryId: 2 });
      await flushPromises();

      expect(window.scrollY).toBe(initialScrollY);
    });

    it('uses smooth scrolling by default', async () => {
      const trackScrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});

      const wrapper = mount(CategoryNav, {
        props: {
          categories: [buildCategory({ id: 1 }), buildCategory({ id: 2, name: 'Botas' })],
          activeCategoryId: undefined,
        },
      });

      await wrapper.setProps({ activeCategoryId: 2 });
      await flushPromises();

      expect(trackScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    });

    it('centers instantly (no animation) when prefers-reduced-motion is set', async () => {
      mockReducedMotion(true);
      const trackScrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});

      const wrapper = mount(CategoryNav, {
        props: {
          categories: [buildCategory({ id: 1 }), buildCategory({ id: 2, name: 'Botas' })],
          activeCategoryId: undefined,
        },
      });

      await wrapper.setProps({ activeCategoryId: 2 });
      await flushPromises();

      expect(trackScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    });
  });
});
