/// <reference types="cypress" />
/**
 * BipFlow: variant pricing smoke -- one deterministic browser journey against
 * the REAL backend proving the per-variant price wiring end to end:
 * select the priced colour -> the shown price changes -> the cart carries it
 * -> the checkout SaleOrder line is charged the variant's effective price.
 *
 * State: `manage.py seed_e2e_demo_data` seeds "Produto Variavel E2E" at
 * R$ 50,00 base with two colours -- P (inherits 50,00) and GG (own 70,00).
 * See docs/architecture/product-variant-pricing.md.
 */

const PRODUCT_NAME = 'Produto Variavel E2E'
const BASE_PRICE = '50,00'
const GG_PRICE = '70,00'

function stubWindowOpen(): void {
  cy.window().then((win) => cy.stub(win, 'open').returns({}).as('windowOpen'))
}

describe('Variant pricing smoke (real backend)', () => {
  it('charges the selected variant effective price through to the SaleOrder', () => {
    const phone = `1198${Date.now().toString().slice(-8)}`

    cy.intercept('POST', '**/api/v1/checkout/whatsapp/').as('checkout')

    cy.visit('/l/default/produtos')

    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 }).should('be.visible').click()
    cy.location('pathname', { timeout: 10000 }).should('match', /\/l\/default\/produtos\/.+/)

    // "P" is auto-selected (first orderable colour) -> base price in the header.
    cy.get('[aria-label="Selecionar cor P"]', { timeout: 10000 }).should('exist')
    cy.get('main').should('contain', BASE_PRICE)

    // Pick the priced colour -> the header price updates, no reload.
    cy.get('[aria-label="Selecionar cor GG"]').click()
    cy.get('main').should('contain', GG_PRICE)

    cy.contains('button', /Adicionar/).click()

    cy.get('[data-cy="open-cart-button"]', { timeout: 10000 }).click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    // Step 1 (review): the selected variant + its per-unit price are visible.
    cy.get('@cart').should('contain', 'GG')
    cy.get('@cart').should('contain', `${GG_PRICE} / unidade`)
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()

    // Step 2 (details). Pickup keeps the flow minimal -- no region / address.
    cy.get('@cart').contains('label', 'Entrega').find('select').select('pickup')
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Variante')
    cy.get('@cart').find('input[autocomplete="tel"]').type(phone)

    // Ciclo 8: Produtos now lives in the body summary, not the footer
    // (pickup has no Frete row); the footer's Total still reflects it too
    // since there is no delivery fee to add on top.
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', GG_PRICE)
    cy.get('@cart').find('footer').should('contain', GG_PRICE)

    stubWindowOpen()

    cy.get('[data-cy="checkout-submit-button"]').should('be.enabled').click()
    cy.wait('@checkout').then(({ response }) => {
      expect(response?.statusCode).to.eq(200)
      const body = response?.body
      expect(body.order_reference).to.match(/^BPF-/)
      expect(body.items).to.have.length(1)
      expect(body.items[0].variant_name).to.eq('GG')
      expect(body.items[0].unit_price).to.eq('70.00')
      expect(body.items[0].line_total).to.eq('70.00')
      expect(body.subtotal).to.eq('70.00')
      expect(body.total).to.eq('70.00')
    })
    cy.get('@windowOpen').should('have.been.calledOnce')
  })
})
