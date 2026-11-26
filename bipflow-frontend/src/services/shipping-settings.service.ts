import api from './api';
import type { StoreShippingSettings, StoreShippingSettingsPayload } from '@/types/shipping';

const ENDPOINT = 'v1/store/current/shipping-settings/';

export const shippingSettingsService = {
  async get(): Promise<StoreShippingSettings> {
    const { data } = await api.get<StoreShippingSettings>(ENDPOINT);
    return data;
  },

  async update(payload: StoreShippingSettingsPayload): Promise<StoreShippingSettings> {
    const { data } = await api.patch<StoreShippingSettings>(ENDPOINT, payload);
    return data;
  },
};
