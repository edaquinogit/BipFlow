import api from './api'
import type {
  PublicStorefrontAppearance,
  PublicStorefrontBanner,
  StorefrontAppearance,
  StorefrontBanner,
  StorefrontBannerPayload,
  StorefrontBannerPlacement,
  StorefrontMediaKind,
  StorefrontMediaUploadResponse,
  StorefrontAppearancePayload,
} from '@/types/store'

export const storefrontAppearanceService = {
  /** Fetch the active store's extended storefront personalization. */
  async get(): Promise<StorefrontAppearance> {
    const response = await api.get<StorefrontAppearance>('v1/store/current/storefront-appearance/')
    return response.data
  },

  /** Fetch public storefront personalization for a visitor-facing store slug. */
  async getPublic(slug: string): Promise<PublicStorefrontAppearance> {
    const response = await api.get<PublicStorefrontAppearance>(`v1/public/stores/${slug}/appearance/`)
    return response.data
  },

  /**
   * Fetch public active banners for a visitor-facing store slug -- both the
   * hero carousel and the promotions rail, in one request (split by
   * `placement` on the caller's side).
   */
  async getPublicBanners(slug: string): Promise<PublicStorefrontBanner[]> {
    const response = await api.get<PublicStorefrontBanner[]>(`v1/public/stores/${slug}/banners/`)
    return response.data
  },

  /** Update the active store's extended storefront personalization. */
  async update(payload: StorefrontAppearancePayload): Promise<StorefrontAppearance> {
    const response = await api.patch<StorefrontAppearance>(
      'v1/store/current/storefront-appearance/',
      payload
    )
    return response.data
  },

  /** List banners for the active dashboard store, scoped to one placement. */
  async listBanners(placement: StorefrontBannerPlacement = 'promotion'): Promise<StorefrontBanner[]> {
    const response = await api.get<StorefrontBanner[]>('v1/store/current/storefront-banners/', {
      params: { placement },
    })
    return response.data
  },

  /** Create one promotional banner for the active dashboard store. */
  async createBanner(payload: StorefrontBannerPayload): Promise<StorefrontBanner> {
    const response = await api.post<StorefrontBanner>(
      'v1/store/current/storefront-banners/',
      payload,
    )
    return response.data
  },

  /** Update one promotional banner scoped to the active dashboard store. */
  async updateBanner(
    id: number,
    payload: StorefrontBannerPayload,
  ): Promise<StorefrontBanner> {
    const response = await api.patch<StorefrontBanner>(
      `v1/store/current/storefront-banners/${id}/`,
      payload,
    )
    return response.data
  },

  /** Delete one promotional banner scoped to the active dashboard store. */
  async deleteBanner(id: number): Promise<void> {
    await api.delete(`v1/store/current/storefront-banners/${id}/`)
  },

  /** Persist banner ordering for the active dashboard store, scoped to one placement. */
  async reorderBanners(
    ids: number[],
    placement: StorefrontBannerPlacement = 'promotion',
  ): Promise<StorefrontBanner[]> {
    const response = await api.post<StorefrontBanner[]>(
      'v1/store/current/storefront-banners/reorder/',
      { ids, placement },
    )
    return response.data
  },

  /** Upload storefront media for the active store, returning a public URL. */
  async uploadMedia(
    kind: StorefrontMediaKind,
    file: File,
  ): Promise<StorefrontMediaUploadResponse> {
    const formData = new FormData()
    formData.append('kind', kind)
    formData.append('file', file)

    const response = await api.post<StorefrontMediaUploadResponse>(
      'v1/store/current/storefront-media/',
      formData,
      {
        headers: { 'Content-Type': undefined },
        timeout: 60000,
      },
    )
    return response.data
  },
}
