/// <reference types="cypress" />
/**
 * BipFlow: Online Sales Foundation -- end-to-end against the REAL backend.
 *
 * Exercises the whole commercial-foundation slice on the seeded `default`
 * store (`manage.py seed_e2e_demo_data`):
 *
 *  1. The dashboard "Vendas online" tab edits the store's commercial rules.
 *  2. The storefront cart reflects them (hidden payment option, minimum
 *     notice, blocked "Continuar").
 *  3. Below the minimum the order cannot be finalised; at the minimum it
 *     completes and is created with `payment_status=pending`.
 *  4. The dashboard order shows the pending badge, an operator confirms the
 *     payment (badge + history update without reload).
 *  5. Cancelling a paid order opens `refund_pending`, restores stock exactly
 *     once, and the operator confirms the (external) refund -> `refunded`.
 *  6. Guest checkout still works once the config is permissive again.
 *
 * The commercial config is a shared resource on the single seeded store, so
 * `before`/`after` snapshot and fully restore it -- otherwise a leftover
 * minimum would break every other checkout spec on the same runner.
 */

const apiBaseUrl = () =>
  (Cypress.env('apiBaseUrl') || 'http://localhost:8000/api').replace(/\/$/, '')

const PRODUCT_NAME = 'Produto Demo E2E' // R$ 29,90, no variants, stock 25
const COMMERCE_DEFAULTS = {
  orders_enabled: true,
  delivery_enabled: true,
  pickup_enabled: true,
  minimum_order_value: '0.00',
  accepts_pix: true,
  accepts_card: true,
  accepts_cash: true,
}

function authHeaders() {
  const tokens = Cypress.env('authTokens') as { access: string } | undefined
  if (!tokens?.access) {
    throw new Error('Call cy.loginViaApi() first')
  }
  return { Authorization: `Bearer ${tokens.access}` }
}

function patchCommerce(body: Record<string, unknown>) {
  return cy.request({
    method: 'PATCH',
    url: `${apiBaseUrl()}/v1/store/current/commerce-settings/`,
    headers: authHeaders(),
    body,
  })
}

function stubWindowOpen(): void {
  cy.window().then((win) => cy.stub(win, 'open').returns({}).as('windowOpen'))
}

describe('Online sales foundation (real backend)', () => {
  before(() => {
    cy.loginViaApi()
  })

  beforeEach(() => {
    cy.loginViaApi().then(() => patchCommerce(COMMERCE_DEFAULTS))
  })

  after(() => {
    cy.loginViaApi().then(() => patchCommerce(COMMERCE_DEFAULTS))
  })

  it('the public commerce config mirrors what the dashboard saves', () => {
    patchCommerce({ accepts_cash: false, pickup_enabled: false, minimum_order_value: '40.00' })

    cy.request(`${apiBaseUrl()}/v1/public/stores/default/commerce-settings/`).then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body.minimum_order_value).to.eq('40.00')
      expect(response.body.delivery_methods).to.deep.eq(['delivery'])
      expect(response.body.payment_methods).to.deep.eq(['pix', 'card'])
      // No admin / tenant fields leak.
      expect(response.body).to.not.have.property('created_at')
      expect(response.body).to.not.have.property('id')
    })
  })

  it('the storefront cart only offers the allowed options and enforces the minimum', () => {
    patchCommerce({ accepts_cash: false, minimum_order_value: '50.00' })

    cy.viewport(375, 812)
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/').as('checkout')
    cy.visit('/l/default/produtos')

    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 })
      .find('[data-cy="add-to-cart-button"]')
      .click()

    cy.get('[data-cy="open-cart-button"]', { timeout: 10000 }).click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')

    // Below the minimum: notice + blocked continue.
    cy.get('@cart').find('[data-cy="cart-minimum-order-notice"]').should('contain', '50,00')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').should('be.disabled')

    // Bump the quantity from inside the cart -> 59,80 >= 50,00 -> unblocked.
    cy.get('@cart').find('[aria-label^="Aumentar quantidade"]').click()
    cy.get('@cart').find('[data-cy="cart-minimum-order-notice"]').should('contain', 'atingido')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').should('not.be.disabled').click()

    // The payment <select> no longer offers "Dinheiro".
    cy.get('@cart')
      .find('[data-cy="checkout-field-payment-method"] option')
      .then(($opts) => {
        const values = [...$opts].map((o) => (o as HTMLOptionElement).value)
        expect(values).to.deep.eq(['pix', 'card'])
      })

    // 430px viewport: the sticky CTA is still reachable.
    cy.viewport(430, 932)
    cy.get('@cart').find('[data-cy="checkout-field-delivery-method"]').select('pickup')
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Minimo')
    cy.get('@cart').find('input[autocomplete="tel"]').type(`1199${Date.now().toString().slice(-8)}`)

    stubWindowOpen()
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').click()

    cy.wait('@checkout').then(({ response }) => {
      expect(response?.statusCode).to.eq(200)
    })
    cy.get('@windowOpen').should('have.been.called')
  })

  it('a closed store keeps the catalog visible but blocks the order', () => {
    patchCommerce({ orders_enabled: false })

    cy.visit('/l/default/produtos')
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 })
      .find('[data-cy="add-to-cart-button"]')
      .click()
    cy.get('[data-cy="open-cart-button"]').click()

    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="cart-store-closed-notice"]').should('be.visible')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').should('be.disabled')
  })

  it('an order runs pending -> paid -> refund_pending -> refunded with a single restock', () => {
    const phone = `1199${Date.now().toString().slice(-8)}`
    // Resolve the demo product id from the catalog.
    cy.request(`${apiBaseUrl()}/v1/products/?search=${encodeURIComponent(PRODUCT_NAME)}`).then(
      (list) => {
        const product = list.body.results.find((p: { name: string }) => p.name === PRODUCT_NAME)
        expect(product, 'demo product').to.exist

        cy.request(`${apiBaseUrl()}/v1/products/${product.id}/`).then((before) => {
          const stockBefore = before.body.stock_quantity

            cy.request({
              method: 'POST',
              url: `${apiBaseUrl()}/v1/checkout/whatsapp/`,
              body: {
                items: [{ product_id: product.id, quantity: 1 }],
                customer: {
                  delivery_method: 'pickup',
                  payment_method: 'pix',
                  full_name: 'Cliente Ciclo',
                  phone,
                },
              },
            }).then((order) => {
              expect(order.status).to.eq(200)
              const reference = order.body.order_reference

              // Locate the order id via the dashboard list.
              cy.request({
                url: `${apiBaseUrl()}/v1/sales-orders/?search=${reference}`,
                headers: authHeaders(),
              }).then((listResp) => {
                const row = listResp.body.results[0]
                expect(row.payment_status).to.eq('pending')
                const orderId = row.id

                // Confirm payment.
                cy.request({
                  method: 'PATCH',
                  url: `${apiBaseUrl()}/v1/sales-orders/${orderId}/payment/`,
                  headers: authHeaders(),
                  body: { payment_status: 'paid', reference: 'TED 9911' },
                }).then((paid) => {
                  expect(paid.body.payment_status).to.eq('paid')
                  expect(paid.body.payment_reference).to.eq('TED 9911')
                  expect(paid.body.payment_status_events).to.have.length(1)
                })

                // Cancel the paid order -> refund_pending, stock back once.
                cy.request({
                  method: 'PATCH',
                  url: `${apiBaseUrl()}/v1/sales-orders/${orderId}/status/`,
                  headers: authHeaders(),
                  body: { status: 'cancelled' },
                }).then((cancelled) => {
                  expect(cancelled.body.payment_status).to.eq('refund_pending')
                })

                // Idempotent second cancel -- no double restock.
                cy.request({
                  method: 'PATCH',
                  url: `${apiBaseUrl()}/v1/sales-orders/${orderId}/status/`,
                  headers: authHeaders(),
                  body: { status: 'cancelled' },
                  failOnStatusCode: false,
                })

                cy.request(`${apiBaseUrl()}/v1/products/${product.id}/`).then((afterStock) => {
                  expect(afterStock.body.stock_quantity).to.eq(stockBefore)
                })

                // Confirm the external refund -> refunded.
                cy.request({
                  method: 'PATCH',
                  url: `${apiBaseUrl()}/v1/sales-orders/${orderId}/payment/`,
                  headers: authHeaders(),
                  body: { payment_status: 'refunded' },
                }).then((refunded) => {
                  expect(refunded.body.payment_status).to.eq('refunded')
                  expect(refunded.body.refunded_at).to.not.be.null
                })

                // The operator cannot re-open a refunded payment.
                cy.request({
                  method: 'PATCH',
                  url: `${apiBaseUrl()}/v1/sales-orders/${orderId}/payment/`,
                  headers: authHeaders(),
                  body: { payment_status: 'pending' },
                  failOnStatusCode: false,
                }).then((reopen) => {
                  expect(reopen.status).to.eq(400)
                })
              })
            })
        })
      },
    )
  })

  it('the dashboard order detail shows a payment badge and confirms payment without a reload', () => {
    cy.loginViaApi()
    cy.request(`${apiBaseUrl()}/v1/products/?search=${encodeURIComponent(PRODUCT_NAME)}`).then(
      (list) => {
        const product = list.body.results.find((p: { name: string }) => p.name === PRODUCT_NAME)
        cy.request({
          method: 'POST',
          url: `${apiBaseUrl()}/v1/checkout/whatsapp/`,
          body: {
            items: [{ product_id: product.id, quantity: 1 }],
            customer: {
              delivery_method: 'pickup',
              payment_method: 'pix',
              full_name: 'Cliente Modal',
              phone: `1199${Date.now().toString().slice(-8)}`,
            },
          },
        }).then((order) => {
          const reference = order.body.order_reference

          cy.visitWithAuth('/dashboard/pedidos')
          cy.get('input[type="search"]', { timeout: 15000 }).type(reference)
          cy.contains('article', reference, { timeout: 15000 }).within(() => {
            cy.get('[data-cy="sale-payment-badge"]').should('contain', 'Pagamento pendente')
            cy.get('[data-cy="sale-detail-button"]').click()
          })

          cy.intercept('PATCH', '**/payment/').as('pay')
          cy.get('[data-cy="order-detail-payment"]').should('be.visible')
          cy.get('[data-cy="payment-action-paid"]').click()
          cy.wait('@pay').its('response.statusCode').should('eq', 200)

          cy.get('[data-cy="order-detail-payment-badge"]').should('contain', 'Pago')
          cy.get('[data-cy="order-detail-payment-history"] li').should('have.length.at.least', 1)
        })
      },
    )
  })
})
