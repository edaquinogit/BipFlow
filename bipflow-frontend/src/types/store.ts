export type StoreStatus = 'active' | 'inactive'

export type ReceiptPaperFormat = '58mm' | '80mm' | 'a4'

export interface StoreTheme {
  primary?: string | null
  accent?: string | null
  background?: string | null
  surface?: string | null
  text?: string | null
  muted?: string | null
}

export interface Store {
  id: number
  name: string
  display_name?: string | null
  slug: string
  logo_url?: string | null
  tagline?: string | null
  whatsapp_phone: string
  theme?: StoreTheme | null
  is_active: boolean
  status?: StoreStatus
  receipt_exchange_policy: string
  receipt_paper_format: ReceiptPaperFormat
}

export interface StoreReceiptSettingsPayload {
  receipt_exchange_policy?: string
  receipt_paper_format?: ReceiptPaperFormat
}

export interface StoreAppearanceSettingsPayload {
  display_name?: string
  logo_url?: string
  tagline?: string
  theme?: StoreTheme
}

/** COMMERCE P1 -- Merchant Profile: commercial identity, contact, address, links. */
export type BrazilianUf =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO'
  | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI'
  | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO'

export interface MerchantProfile {
  legal_name: string
  trade_name: string
  tax_id: string
  contact_email: string
  contact_phone: string
  postal_code: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: BrazilianUf | ''
  country: string
  website_url: string
  instagram_url: string
  facebook_url: string
  tiktok_url: string
  youtube_url: string
  is_complete: boolean
  has_complete_address: boolean
  created_at: string
  updated_at: string
}

export type MerchantProfilePayload = Partial<
  Omit<
    MerchantProfile,
    'is_complete' | 'has_complete_address' | 'created_at' | 'updated_at'
  >
>

/** Storefront-safe subset echoed by the public storefront appearance endpoint. */
export interface PublicMerchantProfile {
  trade_name: string
  city: string
  state: BrazilianUf | ''
  website_url: string
  instagram_url: string
  facebook_url: string
  tiktok_url: string
  youtube_url: string
}

export type CardStyle = 'clean' | 'bordered' | 'elevated'
export type RadiusStyle = 'minimal' | 'rounded' | 'soft'
export type LayoutDensity = 'compact' | 'comfortable'
export type FontPreset = 'modern' | 'editorial' | 'classic'
export type MotionIntensity = 'subtle' | 'standard'
export type DecorationStyle = 'none' | 'circles' | 'soft-shapes' | 'geometric'
export type StorefrontMediaKind = 'logo' | 'banner' | 'favicon' | 'promotion'
export type StorefrontDestinationType = 'none' | 'products' | 'category' | 'product' | 'external_url'
export type StorefrontBannerStatus = 'active' | 'inactive' | 'scheduled' | 'expired'

export interface StorefrontMediaUploadResponse {
  kind: StorefrontMediaKind
  url: string
  path: string
  size: number
  content_type: string
}

export interface StorefrontAppearance {
  id: number
  store_id: number
  secondary_color: string
  favicon_url: string
  hero_enabled: boolean
  hero_image_desktop: string
  hero_image_mobile: string
  hero_alt_text: string
  hero_title: string
  hero_subtitle: string
  hero_cta_text: string
  hero_destination_type: StorefrontDestinationType
  hero_destination_value: string
  hero_cta_url: string
  card_style: CardStyle
  radius_style: RadiusStyle
  density: LayoutDensity
  font_preset: FontPreset
  motion_enabled: boolean
  motion_intensity: MotionIntensity
  decoration_enabled: boolean
  decoration_style: DecorationStyle
  updated_at: string
}

export type StorefrontAppearancePayload = Partial<Omit<StorefrontAppearance, 'id' | 'store_id' | 'updated_at'>>

export type PublicStorefrontAppearance = Omit<StorefrontAppearance, 'id' | 'store_id' | 'updated_at'> & {
  store_name: string
  store_slug: string
  logo_url: string
  tagline: string
  theme: StoreTheme
  merchant: PublicMerchantProfile
}

export interface StorefrontBanner {
  id: number
  store_id: number
  image_url: string
  alt_text: string
  title: string
  subtitle: string
  cta_text: string
  destination_type: StorefrontDestinationType
  destination_value: string
  button_url: string
  position: number
  is_active: boolean
  status: StorefrontBannerStatus
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export type StorefrontBannerPayload = Partial<
  Omit<StorefrontBanner, 'id' | 'store_id' | 'button_url' | 'status' | 'created_at' | 'updated_at'>
>

export type PublicStorefrontBanner = Pick<
  StorefrontBanner,
  | 'image_url'
  | 'alt_text'
  | 'title'
  | 'subtitle'
  | 'cta_text'
  | 'button_url'
  | 'position'
  | 'status'
>

export interface StoreLabelSettings {
  page_format: 'a4'
  columns: number
  rows: number
  margin_mm: number
  cell_padding_mm: number
  qr_size_mm: number
  show_price: boolean
  show_size: boolean
  show_public_code: boolean
  labels_per_page: number
}

export type StoreLabelSettingsPayload = Partial<
  Pick<
    StoreLabelSettings,
    | 'page_format'
    | 'columns'
    | 'rows'
    | 'margin_mm'
    | 'cell_padding_mm'
    | 'qr_size_mm'
    | 'show_price'
    | 'show_size'
    | 'show_public_code'
  >
>
