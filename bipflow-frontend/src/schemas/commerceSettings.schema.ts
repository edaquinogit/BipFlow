import { z } from 'zod'

/**
 * Per-store commercial rules (online-sales foundation, see
 * docs/architecture/online-sales-foundation.md). Mirrors
 * StoreCommerceSettingsSerializer / PublicStoreCommerceSettingsSerializer in
 * bipdelivery/api/serializers.py.
 *
 * The backend is always the authority -- these schemas only shape what the
 * dashboard form edits and what the storefront cart renders as valid options.
 */

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))

const deliveryMethod = z.enum(['delivery', 'pickup'])
const paymentMethod = z.enum(['pix', 'card', 'cash'])

/** Dashboard read/write shape (GET/PATCH /v1/store/current/commerce-settings/). */
export const CommerceSettingsSchema = z.object({
  orders_enabled: z.boolean(),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  minimum_order_value: decimalString,
  accepts_pix: z.boolean(),
  accepts_card: z.boolean(),
  accepts_cash: z.boolean(),
  enabled_delivery_methods: z.array(deliveryMethod).default([]),
  enabled_payment_methods: z.array(paymentMethod).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

/** Storefront-safe shape (GET /v1/public/stores/{slug}/commerce-settings/). */
export const PublicCommerceSettingsSchema = z.object({
  orders_enabled: z.boolean(),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  minimum_order_value: decimalString,
  accepts_pix: z.boolean(),
  accepts_card: z.boolean(),
  accepts_cash: z.boolean(),
  delivery_methods: z.array(deliveryMethod).default([]),
  payment_methods: z.array(paymentMethod).default([]),
})

/** PATCH payload -- every field optional (partial update). */
export const CommerceSettingsPayloadSchema = CommerceSettingsSchema.pick({
  orders_enabled: true,
  delivery_enabled: true,
  pickup_enabled: true,
  accepts_pix: true,
  accepts_card: true,
  accepts_cash: true,
})
  .partial()
  .extend({ minimum_order_value: decimalString.optional() })

export type CommerceSettings = z.infer<typeof CommerceSettingsSchema>
export type PublicCommerceSettings = z.infer<typeof PublicCommerceSettingsSchema>
export type CommerceSettingsPayload = z.infer<typeof CommerceSettingsPayloadSchema>

export type CommerceDeliveryMethod = z.infer<typeof deliveryMethod>
export type CommercePaymentMethod = z.infer<typeof paymentMethod>

/**
 * Client-side mirror of the three backend invariants (a negative minimum, an
 * open store with no delivery mode, an open store with no payment method).
 * UX only -- the backend re-checks and is the real gate. Returns the field
 * keys that are currently invalid so the form can flag them.
 */
export function commerceSettingsInvariantErrors(
  settings: Pick<
    CommerceSettings,
    | 'orders_enabled'
    | 'delivery_enabled'
    | 'pickup_enabled'
    | 'minimum_order_value'
    | 'accepts_pix'
    | 'accepts_card'
    | 'accepts_cash'
  >,
): Partial<Record<keyof CommerceSettings, string>> {
  const errors: Partial<Record<keyof CommerceSettings, string>> = {}
  const minimum = Number(settings.minimum_order_value)

  if (Number.isNaN(minimum) || minimum < 0) {
    errors.minimum_order_value = 'O pedido mínimo não pode ser negativo.'
  }

  if (settings.orders_enabled && !settings.delivery_enabled && !settings.pickup_enabled) {
    errors.delivery_enabled =
      'Com pedidos ativos, habilite entrega ou retirada.'
  }

  if (
    settings.orders_enabled &&
    !settings.accepts_pix &&
    !settings.accepts_card &&
    !settings.accepts_cash
  ) {
    errors.accepts_pix = 'Com pedidos ativos, aceite ao menos uma forma de pagamento.'
  }

  return errors
}
