export interface ShippingPackageOption {
  name: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  tare_weight_grams: number;
}

export interface StoreShippingSettings {
  national_shipping_enabled: boolean;
  origin_postal_code: string;
  packaging_weight_grams: number;
  package_options: ShippingPackageOption[];
}

export type StoreShippingSettingsPayload = Partial<
  Pick<
    StoreShippingSettings,
    'origin_postal_code' | 'packaging_weight_grams' | 'package_options'
  >
>;
