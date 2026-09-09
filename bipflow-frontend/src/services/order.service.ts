import api from './api'
import { getStoredBotSessionId } from './bot.service'
import { getSelectedStoreSlug } from './store-scope'
import type {
  CartCustomer,
  CartItem,
  CheckoutPayload,
  CheckoutResponse,
} from '@/types/product'
import { isAxiosError } from '@/types/errors'
import { formatBRL } from '@/utils/formatters'
import { effectiveUnitPrice } from '@/utils/pricing'

const CHECKOUT_IDEMPOTENCY_STORAGE_PREFIX = 'bipflow_checkout_idempotency'

interface StoredCheckoutIdempotency {
  fingerprint: string
  key: string
}

/**
 * CheckoutWhatsAppView returns a distinct `code` for the two guest-data
 * gaps a checkout attempt can still hit (missing name/phone, or missing
 * delivery address) -- surfacing them specifically beats a generic "try
 * again" toast, since both are fixable right there in the cart drawer.
 */
export function extractCheckoutErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { code?: string; detail?: string } | undefined

    if (data?.code === 'guest_identity_required') {
      return 'Informe seu nome e telefone para finalizar o pedido.'
    }

    if (data?.code === 'guest_address_incomplete') {
      return 'Informe endereco, bairro e cidade para receber em casa.'
    }

    if (data?.code === 'whatsapp_not_configured') {
      return 'WhatsApp da loja ainda nao configurado.'
    }

    // Online-sales foundation: the store's commercial rules rejected this
    // order. The backend already sends a clear `detail`, but pin the wording
    // per code so it stays stable regardless of backend copy tweaks.
    if (data?.code === 'store_not_accepting_orders') {
      return 'Esta loja nao esta aceitando pedidos no momento.'
    }

    if (data?.code === 'delivery_method_unavailable') {
      return 'A forma de entrega escolhida nao esta disponivel nesta loja.'
    }

    if (data?.code === 'payment_method_unavailable') {
      return 'A forma de pagamento escolhida nao e aceita por esta loja.'
    }

    if (data?.code === 'minimum_order_not_reached') {
      return data.detail ?? 'O valor do pedido esta abaixo do minimo da loja.'
    }

    if (data?.code === 'delivery_region_unavailable') {
      return 'A regiao de entrega selecionada nao esta disponivel nesta loja.'
    }

    if (data?.code === 'idempotency_key_conflict') {
      return 'Este checkout mudou desde a ultima tentativa. Revise o pedido e tente novamente.'
    }

    if (typeof data?.detail === 'string') {
      return data.detail
    }
  }

  return 'Nao foi possivel registrar o pedido agora. Revise os dados e tente novamente.'
}

function buildCheckoutPayload(items: CartItem[], customer: CartCustomer): CheckoutPayload {
  const payload: CheckoutPayload = {
    items: items.map((item) => ({
      product_id: item.product.id,
      variant_id: item.variant?.id ?? null,
      quantity: item.quantity,
    })),
    customer: {
      delivery_method: customer.deliveryMethod,
      payment_method: customer.paymentMethod,
      delivery_region_id: customer.deliveryRegionId,
      notes: customer.notes.trim(),
      full_name: customer.fullName.trim(),
      phone: customer.phone.trim(),
      email: customer.email.trim(),
      address: customer.address.trim(),
      neighborhood: customer.neighborhood.trim(),
      city: customer.city.trim(),
    },
  }

  const botSessionId = getStoredBotSessionId()
  if (botSessionId) {
    payload.bot_session_id = botSessionId
  }

  return payload
}

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function checkoutIdempotencyStorageKey(): string {
  const slug = getSelectedStoreSlug() || 'default'
  return `${CHECKOUT_IDEMPOTENCY_STORAGE_PREFIX}_${slug}`
}

function checkoutPayloadFingerprint(payload: CheckoutPayload): string {
  const fingerprintPayload = {
    items: payload.items,
    customer: payload.customer,
    bot_session_id: payload.bot_session_id ?? '',
  }
  const serialized = JSON.stringify(fingerprintPayload)
  let hash = 2166136261

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function newCheckoutIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function getCheckoutIdempotencyKey(payload: CheckoutPayload): string {
  const fingerprint = checkoutPayloadFingerprint(payload)

  if (!canUseBrowserStorage()) {
    return newCheckoutIdempotencyKey()
  }

  const storageKey = checkoutIdempotencyStorageKey()
  const storedValue = window.localStorage.getItem(storageKey)
  if (storedValue) {
    try {
      const stored = JSON.parse(storedValue) as StoredCheckoutIdempotency
      if (stored.fingerprint === fingerprint && stored.key) {
        return stored.key
      }
    } catch {
      window.localStorage.removeItem(storageKey)
    }
  }

  const key = newCheckoutIdempotencyKey()
  window.localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }))
  return key
}

function clearCheckoutIdempotencyKey(payload: CheckoutPayload): void {
  if (!canUseBrowserStorage()) {
    return
  }

  const storageKey = checkoutIdempotencyStorageKey()
  const storedValue = window.localStorage.getItem(storageKey)
  if (!storedValue) {
    return
  }

  try {
    const stored = JSON.parse(storedValue) as StoredCheckoutIdempotency
    if (stored.fingerprint === checkoutPayloadFingerprint(payload)) {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    window.localStorage.removeItem(storageKey)
  }
}

function buildWhatsAppHandoffMessage(items: CartItem[], subtotal: number): string {
  const itemLines = items.map((item, index) => {
    const lineTotal = Number(effectiveUnitPrice(item.product, item.variant)) * item.quantity
    const sku = item.product.sku ? ` (${item.product.sku})` : ''
    const variant = item.variant?.name ? ` - ${item.variant.name}` : ''

    return `${index + 1}. ${item.product.name}${variant}${sku} x${item.quantity} - ${formatBRL(lineTotal)}`
  })

  return [
    'Ola! Quero finalizar este pedido:',
    '',
    ...itemLines,
    '',
    `Subtotal dos produtos: ${formatBRL(subtotal)}`,
    '',
    'Podem me orientar com entrega, pagamento e confirmacao?',
  ].join('\n')
}

function buildWhatsAppHandoffUrl(phoneDigits: string, items: CartItem[], subtotal: number): string {
  const normalizedPhone = phoneDigits.replace(/\D/g, '')
  const message = buildWhatsAppHandoffMessage(items, subtotal)

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`
}

export const orderService = {
  async checkoutViaWhatsApp(items: CartItem[], customer: CartCustomer): Promise<CheckoutResponse> {
    const payload = buildCheckoutPayload(items, customer)
    payload.idempotency_key = getCheckoutIdempotencyKey(payload)
    const response = await api.post<CheckoutResponse>('v1/checkout/whatsapp/', payload)
    clearCheckoutIdempotencyKey(payload)
    return response.data
  },

  buildWhatsAppHandoffMessage,
  buildWhatsAppHandoffUrl,
}
