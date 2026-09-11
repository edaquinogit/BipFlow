import { z } from 'zod'

/**
 * Etapa 3 of the QR-code stock-exit evolution: point-of-sale checkout for
 * the physical store. Mirrors bipdelivery/api/pdv.py's serializers (see
 * docs/architecture/qrcode-stock-exit-evolution.md) -- resolves cart items
 * by the scanned/typed `public_code` instead of a numeric product id, the
 * way CheckoutPayloadItem (types/product.ts) does for the WhatsApp cart.
 */
export const PDV_PAYMENT_METHODS = ['pix', 'card', 'cash'] as const
export type PdvPaymentMethod = (typeof PDV_PAYMENT_METHODS)[number]

export interface PdvSaleItemPayload {
  public_code: string
  variant_id?: number | null
  quantity: number
}

export interface PdvSaleRequestPayload {
  items: PdvSaleItemPayload[]
  payment_method: PdvPaymentMethod
  customer_name?: string
  // Etapa R4 of the QR-code stock-exit refinement: optional, but capturing
  // it lets a PDV sale count toward the new-vs-returning customer insight
  // the same way a virtual checkout's required phone already does.
  customer_phone?: string
  // PDV receipt PDF/email evolution: optional, lets the cashier email the
  // printed receipt right after the sale finalizes.
  customer_email?: string
  notes?: string
  // PDV/QR/payment evolution: one opaque value per running cart, reused on
  // every retry. A double-tapped "Finalizar venda", a held Enter or a
  // network-retried request under the same key returns the original sale
  // instead of ringing it up again (bipdelivery/api/pdv.py).
  idempotency_key?: string
}

export const PdvSaleItemResponseSchema = z.object({
  product_id: z.number(),
  variant_id: z.number().nullable().optional().default(null),
  product_name: z.string(),
  variant_name: z.string().optional().default(''),
  variant_color_hex: z.string().optional().default(''),
  variant_image_url: z.string().optional().default(''),
  public_code: z.string(),
  quantity: z.number(),
  unit_price: z.union([z.string(), z.number()]).transform((value) => String(value)),
  line_total: z.union([z.string(), z.number()]).transform((value) => String(value)),
})

export const PdvSaleResponseSchema = z.object({
  order_reference: z.string(),
  items: z.array(PdvSaleItemResponseSchema),
  subtotal: z.union([z.string(), z.number()]).transform((value) => String(value)),
  total: z.union([z.string(), z.number()]).transform((value) => String(value)),
  payment_method: z.string(),
  created_at: z.string(),
  customer_email: z.string().optional().default(''),
})

export type PdvSaleResponse = z.infer<typeof PdvSaleResponseSchema>
