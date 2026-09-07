/// <reference types="cypress" />
/**
 * BipFlow: critical purchase smoke -- one representative end-to-end journey
 * against the REAL backend (not stubbed), proving the storefront wiring that
 * pytest cannot see: search -> product detail -> quantity -> cart subtotal ->
 * delivery region + fee -> checkout submission -> a real SaleOrder whose
 * persisted subtotal / fee / total / line items match what the UI showed.
 *
 * State is the deterministic catalog from `manage.py seed_e2e_demo_data`:
 *   - store "default", WhatsApp configured
 *   - DeliveryRegion "Centro" -> fee R$ 5,00
 *   - Product "Produto Demo E2E" -> R$ 29,90, stock 25, NO variants
 *
 * The seeded product is deliberately variant-less, so the "select a variant"
 * step is genuinely N/A here; variant-at-checkout (accept own, reject foreign,
 * reject inactive) is covered exhaustively in
 * bipdelivery/tests/test_api_health.py::CheckoutWhatsAppAPITest.
 */

const PRODUCT_NAME = 'Produto Demo E2E'
const UNIT_PRICE = '29.90'
const QTY = 2
const EXPECTED_SUBTOTAL = '59.80' // 29.90 * 2
const EXPECTED_FEE = '5.00'
const EXPECTED_TOTAL = '64.80'

// window.open: on success the app opens the real wa.me URL, which Electron
// headless cannot hand off (ERR_ABORTED). Returning a truthy object keeps the
// app from falling back to a real window.location navigation.
function stubWindowOpen(): void {
  cy.window().then((win) => cy.stub(win, 'open').returns({}).as('windowOpen'))
}

describe('Critical purchase smoke (real backend)', () => {
  it('search -> detail -> cart -> delivery region -> checkout persists a matching SaleOrder', () => {
    const phone = `119${Date.now().toString().slice(-8)}` // unique per run: phone-keyed checkout throttle

    cy.intercept('GET', '**/api/v1/products/**').as('catalog')
    cy.intercept('GET', '**/api/v1/delivery-regions/active/').as('regions')
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/').as('checkout')

    cy.visit('/l/default/produtos')

    // 1. Search narrows the catalog to the seeded product.
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 }).should('be.visible')

    // 2. Open the ProductDetail page for it.
    cy.contains('article', PRODUCT_NAME).click()
    cy.location('pathname', { timeout: 10000 }).should('match', /\/l\/default\/produtos\/.+/)
    cy.contains(PRODUCT_NAME).should('be.visible')

    // 3. Bump quantity to 2 and add to the cart from the detail page.
    cy.get('button[aria-label="Aumentar quantidade"]').click()
    cy.contains('button', `Adicionar ${QTY}`).click()

    // 4. Open the cart (step 1: review) and confirm the subtotal the UI
    //    computed, then advance to the details step.
    cy.get('[data-cy="open-cart-button"]', { timeout: 10000 }).click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('footer').should('contain', EXPECTED_SUBTOTAL.replace('.', ','))
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()

    // 5. Delivery is the default method -- pick the seeded region and confirm
    //    the fee + recomputed total the UI shows.
    cy.wait('@regions').its('response.statusCode').should('eq', 200)
    cy.get('@cart')
      .contains('label', 'Regiao de entrega')
      .find('select')
      .then(($select) => {
        const centro = [...$select[0].options].find((o) => /Centro/.test(o.textContent ?? ''))
        expect(centro, 'seeded "Centro" region option').to.exist
        cy.wrap($select).select((centro as HTMLOptionElement).value)
      })
    // Ciclo 8: on the 'details' step, Produtos/Frete moved out of the footer
    // into the compact body summary -- the footer now shows Total only.
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', EXPECTED_FEE.replace('.', ','))
    cy.get('@cart').find('footer').should('contain', EXPECTED_TOTAL.replace('.', ','))
    cy.get('@cart').find('footer').should('not.contain', 'Frete')

    // 6. Complete the mandatory guest fields.
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Smoke')
    cy.get('@cart').find('input[autocomplete="tel"]').type(phone)
    cy.get('@cart').find('input[autocomplete="street-address"]').type('Rua Smoke, 100')
    cy.get('@cart').find('input[autocomplete="address-level3"]').type('Centro')
    cy.get('@cart').find('input[autocomplete="address-level2"]').type('Salvador')

    stubWindowOpen()

    // 7. Submit and assert the backend-authoritative response.
    cy.get('[data-cy="checkout-submit-button"]').should('be.enabled').click()
    cy.wait('@checkout').then(({ response }) => {
      expect(response?.statusCode).to.eq(200)
      const body = response?.body
      expect(body.order_reference, 'a real SaleOrder was created').to.match(/^BPF-/)
      expect(body.subtotal).to.eq(EXPECTED_SUBTOTAL)
      expect(body.delivery_fee).to.eq(EXPECTED_FEE)
      expect(body.total).to.eq(EXPECTED_TOTAL)
      expect(body.customer.delivery_region_name).to.eq('Centro')
      expect(body.items).to.have.length(1)
      expect(body.items[0].quantity).to.eq(QTY)
      expect(body.items[0].unit_price).to.eq(UNIT_PRICE)
      expect(body.items[0].line_total).to.eq(EXPECTED_SUBTOTAL)
      expect(body.whatsapp_url).to.match(/^https:\/\/wa\.me\//)
    })
    cy.get('@windowOpen').should('have.been.calledOnce')
  })
})
