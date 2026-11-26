import { z } from 'zod'
import type { Category } from '@/schemas/category.schema'

/**
 * ========================================
 * 🛍️ CUSTOMER-FACING PRODUCT TYPES
 * ========================================
 *
 * TypeScript interfaces and Zod schemas for the customer-facing
 * products page with pagination, filtering, and search.
 */

/**
 * Category for customer display
 */
export interface ProductCategory {
  id: number
  name: string
  slug: string | null
  parent?: number | null
  parent_name?: string | null
}

export interface ProductVariant {
  id: number
  name: string
  color_hex: string
  // Optional per-variant price override ("69.90"); null means "inherit the
  // product's base price". `effective_price` is that fallback already
  // resolved server-side -- see docs/architecture/product-variant-pricing.md.
  price: string | null
  effective_price: string
  stock_quantity: number
  image: string | null
  is_active: boolean
  position: number
}

/**
 * Product for customer display (simplified from admin schema)
 */
export interface Product {
  id: number
  name: string
  slug: string | null
  public_code?: string
  sku?: string | null
  description?: string | null
  price: string
  size?: string | null
  weight_grams?: number | null
  length_cm?: string | number | null
  width_cm?: string | number | null
  height_cm?: string | number | null
  category: ProductCategory
  image: string | null
  images?: string[]
  variants?: ProductVariant[]
  stock_quantity: number
  low_stock_threshold?: number | null
  is_available: boolean
  created_at: string
}

export interface ProductDetail extends Product {
  sku: string | null
  description: string | null
  size: string | null
}

/**
 * Product filters for customer search
 */
export interface ProductFilters {
  search?: string
  categoryId?: number
  priceMin?: number
  priceMax?: number
  inStockOnly?: boolean
}

export type ProductSortOption =
  | 'featured'
  | 'price-asc'
  | 'price-desc'
  | 'name-asc'
  | 'newest'

export interface CartItem {
  product: Product
  quantity: number
  variant?: ProductVariant | null
}

// Guest checkout reinstated: identity/address (fullName, phone, email,
// address, neighborhood, city) are collected here again for whoever has no
// usable CustomerProfile (see types/customer.ts for the profile shape) --
// the backend prefers the profile when one exists and is complete, and
// only reads these as a fallback otherwise.
export interface NationalShippingSelection {
  destination_postal_code: string
  state: string
  service: string
  expected_price: string
}

export interface CartCustomer {
  deliveryMethod: 'delivery' | 'pickup'
  paymentMethod: 'pix' | 'card' | 'cash'
  deliveryRegionId: number | null
  deliveryRegionName: string
  deliveryRegionFee: number
  notes: string
  fullName: string
  phone: string
  email: string
  address: string
  neighborhood: string
  city: string
}

export interface CheckoutPayloadItem {
  product_id: number
  variant_id?: number | null
  quantity: number
}

export interface CheckoutPayloadCustomer {
  delivery_method: 'delivery' | 'pickup'
  payment_method: 'pix' | 'card' | 'cash'
  delivery_region_id: number | null
  notes: string
  full_name: string
  phone: string
  email: string
  address: string
  neighborhood: string
  city: string
}

export interface CheckoutPayload {
  national_shipping?: NationalShippingSelection
  items: CheckoutPayloadItem[]
  customer: CheckoutPayloadCustomer
  bot_session_id?: string
  idempotency_key?: string
}

export interface CheckoutResponseItem {
  product_id: number
  variant_id: number | null
  product_name: string
  variant_name: string
  variant_color_hex: string
  variant_image_url: string
  sku: string
  quantity: number
  unit_price: string
  line_total: string
}

// Unlike CheckoutPayloadCustomer, the response still carries identity/
// address -- it's just read from the customer's profile server-side now,
// not submitted in the request.
export interface CheckoutResponseCustomer {
  full_name: string
  phone: string
  email: string
  delivery_method: 'delivery' | 'pickup'
  payment_method: 'pix' | 'card' | 'cash'
  delivery_region_id: number | null
  delivery_region_name?: string
  address: string
  neighborhood: string
  city: string
  notes: string
}

export interface CheckoutResponse {
  order_reference: string
  items: CheckoutResponseItem[]
  customer: CheckoutResponseCustomer
  subtotal: string
  delivery_fee: string
  total: string
  message: string
  whatsapp_url: string
}

export type ProductFilterCategory = Pick<Category, 'id' | 'name'> &
  Partial<Pick<Category, 'parent' | 'parent_name'>>

/**
 * Paginated API response
 */
export interface PaginatedProductsResponse {
  count: number
  next: string | null
  previous: string | null
  page_size: number
  total_pages: number
  results: Product[]
}

/**
 * Zod schemas for validation
 */
export const ProductCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string().nullable(),
  parent: z.number().nullable().optional(),
  parent_name: z.string().nullable().optional(),
})

export const ProductVariantSchema = z.object({
  id: z.number(),
  name: z.string(),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  price: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value))),
  // Empty string when an older backend omits it; callers fall back to the
  // product's base price in that case.
  effective_price: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? '' : String(value))),
  stock_quantity: z.number().int().nonnegative().default(0),
  image: z.string().url().nullable().optional().default(null),
  is_active: z.boolean(),
  position: z.number(),
})

export const ProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string().nullable(),
  public_code: z.string().optional(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).transform((value) => String(value)),
  size: z.string().nullable().optional(),
  weight_grams: z.number().int().positive().nullable().optional(),
  length_cm: z.union([z.string(), z.number()]).nullable().optional(),
  width_cm: z.union([z.string(), z.number()]).nullable().optional(),
  height_cm: z.union([z.string(), z.number()]).nullable().optional(),
  category: ProductCategorySchema,
  image: z.string().url().nullable(),
  images: z.array(z.string().url()).optional().default([]),
  variants: z.array(ProductVariantSchema).optional().default([]),
  stock_quantity: z.number(),
  low_stock_threshold: z.number().nullable().optional(),
  is_available: z.boolean(),
  created_at: z.string(),
})

export const ProductDetailSchema = ProductSchema.extend({
  sku: z.string().nullable(),
  description: z.string().nullable(),
  size: z.string().nullable(),
  images: z.array(z.string().url()).default([]),
})

export const PaginatedProductsResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  page_size: z.number(),
  total_pages: z.number(),
  results: z.array(ProductSchema),
})

export const ProductFiltersSchema = z.object({
  search: z.string().optional(),
  categoryId: z.number().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  inStockOnly: z.boolean().optional(),
})

/**
 * Type guards
 */
export const isProduct = (obj: unknown): obj is Product => {
  return ProductSchema.safeParse(obj).success
}

export const isPaginatedResponse = (obj: unknown): obj is PaginatedProductsResponse => {
  return PaginatedProductsResponseSchema.safeParse(obj).success
}
