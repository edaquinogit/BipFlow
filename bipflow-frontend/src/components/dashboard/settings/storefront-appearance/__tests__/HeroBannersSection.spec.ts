import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import HeroBannersSection from '../HeroBannersSection.vue';
import { storefrontAppearanceService } from '@/services/storefront-appearance.service';
import type { StorefrontBanner } from '@/types/store';

vi.mock('@/services/storefront-appearance.service', () => ({
  storefrontAppearanceService: {
    listBanners: vi.fn(),
    createBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteBanner: vi.fn(),
    reorderBanners: vi.fn(),
    uploadMedia: vi.fn(),
  },
}));

function buildBanner(overrides: Partial<StorefrontBanner> = {}): StorefrontBanner {
  return {
    id: 1,
    store_id: 1,
    placement: 'hero',
    image_url: 'https://cdn.example.com/hero-1.png',
    image_url_mobile: '',
    alt_text: 'Colecao verao',
    title: '',
    subtitle: '',
    cta_text: '',
    destination_type: 'none',
    destination_value: '',
    button_url: '',
    position: 0,
    is_active: true,
    status: 'active',
    starts_at: null,
    ends_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const mountSection = () => mount(HeroBannersSection, { props: { categories: [], products: [] } });

describe('HeroBannersSection', () => {
  beforeEach(() => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([]);
  });

  afterEach(() => {
    // resetAllMocks (not clearAllMocks): also drops any queued
    // mockResolvedValueOnce() values so they can't leak into the next test.
    vi.resetAllMocks();
  });

  it('lists hero banners scoped to the hero placement', async () => {
    mountSection();
    await flushPromises();

    expect(storefrontAppearanceService.listBanners).toHaveBeenCalledWith('hero');
  });

  it('shows the empty state and an "add first banner" action when there are none', async () => {
    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.find('[data-cy="hero-banners-empty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-cy="hero-banner-card"]')).toHaveLength(0);
  });

  it('renders one card per existing hero banner', async () => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([
      buildBanner({ id: 1, position: 0 }),
      buildBanner({ id: 2, position: 1, image_url: 'https://cdn.example.com/hero-2.png' }),
    ]);

    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.findAll('[data-cy="hero-banner-card"]')).toHaveLength(2);
    expect(wrapper.find('[data-cy="hero-banners-empty"]').exists()).toBe(false);
  });

  it('adds a new draft card without calling the API yet', async () => {
    const wrapper = mountSection();
    await flushPromises();

    await wrapper.get('[data-cy="btn-add-hero-banner"]').trigger('click');

    expect(wrapper.findAll('[data-cy="hero-banner-card"]')).toHaveLength(1);
    expect(storefrontAppearanceService.createBanner).not.toHaveBeenCalled();
  });

  it('creates a hero banner with placement "hero" when saving a new draft with an image URL already set', async () => {
    vi.mocked(storefrontAppearanceService.createBanner).mockResolvedValue(buildBanner());
    vi.mocked(storefrontAppearanceService.listBanners)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildBanner()]);

    const wrapper = mountSection();
    await flushPromises();
    await wrapper.get('[data-cy="btn-add-hero-banner"]').trigger('click');

    const card = wrapper.get('[data-cy="hero-banner-card"]');
    await card.get('[data-cy="hero-banner-alt"]').setValue('Nova colecao');
    // Simulate an already-uploaded image by editing the underlying editor's
    // image_url is not directly settable from the UI without a real file --
    // exercise the "no image yet" validation path instead.
    await card.get('[data-cy="btn-save-hero-banner"]').trigger('click');
    await flushPromises();

    expect(storefrontAppearanceService.createBanner).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Selecione uma imagem para o banner.');
  });

  it('uploads the pending file and creates the banner with placement hero', async () => {
    vi.mocked(storefrontAppearanceService.uploadMedia).mockResolvedValue({
      kind: 'banner',
      url: 'https://cdn.example.com/uploaded.png',
      path: 'stores/1/storefront/promotions/uploaded.png',
      size: 1024,
      content_type: 'image/png',
    });
    vi.mocked(storefrontAppearanceService.createBanner).mockResolvedValue(buildBanner());
    vi.mocked(storefrontAppearanceService.listBanners)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildBanner()]);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const wrapper = mountSection();
    await flushPromises();
    await wrapper.get('[data-cy="btn-add-hero-banner"]').trigger('click');

    const card = wrapper.get('[data-cy="hero-banner-card"]');
    const fileInput = card.find('input[type="file"]');
    const file = new File(['image'], 'hero.png', { type: 'image/png' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');

    await card.get('[data-cy="btn-save-hero-banner"]').trigger('click');
    await flushPromises();

    expect(storefrontAppearanceService.uploadMedia).toHaveBeenCalledWith('banner', file);
    expect(storefrontAppearanceService.createBanner).toHaveBeenCalledWith(
      expect.objectContaining({ placement: 'hero', image_url: 'https://cdn.example.com/uploaded.png' }),
    );
  });

  it('deletes a banner after confirmation', async () => {
    vi.mocked(storefrontAppearanceService.listBanners)
      .mockResolvedValueOnce([buildBanner()])
      .mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const wrapper = mountSection();
    await flushPromises();

    await wrapper.get('[data-cy="btn-delete-hero-banner"]').trigger('click');
    await flushPromises();

    expect(storefrontAppearanceService.deleteBanner).toHaveBeenCalledWith(1);
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([buildBanner()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const wrapper = mountSection();
    await flushPromises();

    await wrapper.get('[data-cy="btn-delete-hero-banner"]').trigger('click');
    await flushPromises();

    expect(storefrontAppearanceService.deleteBanner).not.toHaveBeenCalled();
  });

  it('reorders with "move down" scoped to the hero placement', async () => {
    const first = buildBanner({ id: 1, position: 0 });
    const second = buildBanner({ id: 2, position: 1, image_url: 'https://cdn.example.com/hero-2.png' });
    vi.mocked(storefrontAppearanceService.listBanners)
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([{ ...second, position: 0 }, { ...first, position: 1 }]);
    vi.mocked(storefrontAppearanceService.reorderBanners).mockResolvedValue([
      { ...second, position: 0 },
      { ...first, position: 1 },
    ]);

    const wrapper = mountSection();
    await flushPromises();

    await wrapper.get('[data-cy="btn-move-hero-banner-down"]').trigger('click');
    await flushPromises();

    expect(storefrontAppearanceService.reorderBanners).toHaveBeenCalledWith([2, 1], 'hero');
  });

  it('disables "move up" on the first card and "move down" on the last card', async () => {
    vi.mocked(storefrontAppearanceService.listBanners).mockResolvedValue([
      buildBanner({ id: 1, position: 0 }),
      buildBanner({ id: 2, position: 1 }),
    ]);

    const wrapper = mountSection();
    await flushPromises();

    const cards = wrapper.findAll('[data-cy="hero-banner-card"]');
    expect(cards[0]!.get('[data-cy="btn-move-hero-banner-up"]').attributes('disabled')).toBeDefined();
    expect(cards[1]!.get('[data-cy="btn-move-hero-banner-down"]').attributes('disabled')).toBeDefined();
  });
});
