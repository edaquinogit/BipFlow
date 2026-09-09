import { describe, it, expect } from 'vitest'
import {
  getChannelLabel,
  getDeliveryMethodLabel,
  getPaymentActionLabel,
  getPaymentLabel,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  getSaleStatusBadgeClass,
  getSaleStatusLabel,
  PAYMENT_STATUS_FILTER_OPTIONS,
  SALE_STATUS_OPTIONS,
  SALE_TIMELINE_STEPS,
} from '../saleOrder'
import type { PaymentStatus } from '@/types/sales'

describe('getSaleStatusLabel', () => {
  it('has a label for every status referenced by SALE_STATUS_OPTIONS', () => {
    for (const option of SALE_STATUS_OPTIONS) {
      expect(getSaleStatusLabel(option.value)).toBe(option.label)
    }
  })
})

describe('getPaymentLabel', () => {
  it('maps every payment method to a Portuguese label', () => {
    expect(getPaymentLabel('pix')).toBe('Pix')
    expect(getPaymentLabel('card')).toBe('Cartao')
    expect(getPaymentLabel('cash')).toBe('Dinheiro')
  })
})

describe('getDeliveryMethodLabel', () => {
  it('maps delivery to Delivery and pickup to Retirada', () => {
    expect(getDeliveryMethodLabel('delivery')).toBe('Delivery')
    expect(getDeliveryMethodLabel('pickup')).toBe('Retirada')
  })
})

describe('getChannelLabel', () => {
  it('maps virtual and loja_fisica to Portuguese labels', () => {
    expect(getChannelLabel('virtual')).toBe('Virtual')
    expect(getChannelLabel('loja_fisica')).toBe('Loja fisica')
  })
})

describe('SALE_TIMELINE_STEPS', () => {
  it('only lists the non-cancelled statuses, in order', () => {
    expect(SALE_TIMELINE_STEPS.map((step) => step.value)).toEqual(['prepared', 'sent', 'delivered'])
  })
})

describe('getSaleStatusBadgeClass', () => {
  it('has a badge class for every status referenced by SALE_STATUS_OPTIONS', () => {
    for (const option of SALE_STATUS_OPTIONS) {
      expect(getSaleStatusBadgeClass(option.value)).toBeTruthy()
    }
  })
})

const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  'pending',
  'paid',
  'failed',
  'refund_pending',
  'refunded',
  'cancelled',
]

describe('payment status helpers', () => {
  it('has a label and a badge class for every payment status', () => {
    for (const status of ALL_PAYMENT_STATUSES) {
      expect(getPaymentStatusLabel(status)).toBeTruthy()
      expect(getPaymentStatusBadgeClass(status)).toBeTruthy()
    }
  })

  it('PAYMENT_STATUS_FILTER_OPTIONS covers every payment status', () => {
    expect(PAYMENT_STATUS_FILTER_OPTIONS.map((option) => option.value).sort())
      .toEqual([...ALL_PAYMENT_STATUSES].sort())
  })

  it('worded refund action as confirming an external refund', () => {
    expect(getPaymentActionLabel('refunded')).toBe('Confirmar reembolso realizado')
    expect(getPaymentActionLabel('paid')).toBe('Confirmar pagamento')
    expect(getPaymentActionLabel('failed')).toBe('Registrar falha no pagamento')
    expect(getPaymentActionLabel('pending')).toBe('Registrar nova tentativa')
  })
})
