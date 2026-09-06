import api from './api'
import type {
  MerchantProfile,
  MerchantProfilePayload,
  Store,
  StoreAppearanceSettingsPayload,
  StoreLabelSettings,
  StoreLabelSettingsPayload,
  StoreReceiptSettingsPayload,
} from '@/types/store'

export const storeService = {
  async getCurrent(): Promise<Store> {
    const response = await api.get<Store>('v1/store/current/')
    return response.data
  },

  /** Fetch the active store's merchant profile (COMMERCE P1). */
  async getMerchantProfile(): Promise<MerchantProfile> {
    const response = await api.get<MerchantProfile>('v1/store/current/merchant-profile/')
    return response.data
  },

  /** Partially update the active store's merchant profile. Omitted fields are preserved. */
  async updateMerchantProfile(payload: MerchantProfilePayload): Promise<MerchantProfile> {
    const response = await api.patch<MerchantProfile>(
      'v1/store/current/merchant-profile/',
      payload
    )
    return response.data
  },

  /** Stores the authenticated user belongs to (Etapa 4 store switcher). */
  async getMine(): Promise<Store[]> {
    const response = await api.get<Store[]>('v1/store/mine/')
    return response.data
  },

  /** Create an additional store owned by the authenticated user. */
  async create(name: string): Promise<Store> {
    const response = await api.post<Store>('v1/store/mine/', { name })
    return response.data
  },

  /** Rename a store the authenticated user owns or manages. */
  async rename(slug: string, name: string): Promise<Store> {
    const response = await api.patch<Store>(`v1/store/mine/${slug}/`, { name })
    return response.data
  },

  /** Update controlled storefront appearance settings. */
  async updateAppearance(slug: string, payload: StoreAppearanceSettingsPayload): Promise<Store> {
    const response = await api.patch<Store>(`v1/store/mine/${slug}/appearance/`, payload)
    return response.data
  },

  /** Update controlled storefront appearance settings for the active store. */
  async updateCurrentAppearance(payload: StoreAppearanceSettingsPayload): Promise<Store> {
    const response = await api.patch<Store>('v1/store/current/appearance/', payload)
    return response.data
  },

  /** Fetch one store's printable product label settings. */
  async getLabelSettings(slug: string): Promise<StoreLabelSettings> {
    const response = await api.get<StoreLabelSettings>(`v1/store/mine/${slug}/label-settings/`)
    return response.data
  },

  /** Update one store's printable product label settings. */
  async updateLabelSettings(
    slug: string,
    payload: StoreLabelSettingsPayload
  ): Promise<StoreLabelSettings> {
    const response = await api.patch<StoreLabelSettings>(
      `v1/store/mine/${slug}/label-settings/`,
      payload
    )
    return response.data
  },

  /** Update a store's PDV receipt settings (exchange policy + paper format). */
  async updateReceiptSettings(slug: string, payload: StoreReceiptSettingsPayload): Promise<Store> {
    const response = await api.patch<Store>(`v1/store/mine/${slug}/receipt-settings/`, payload)
    return response.data
  },
}
