/// <reference types="cypress" />
/**
 * BipFlow: Ciclo 8 -- checkout details validation, against the REAL backend.
 *
 * Proves the per-field validation layer end to end: a blocked attempt with
 * missing guest data reveals the general banner and per-field messages,
 * moves focus to the first invalid field, and once everything is filled in
 * the same values (customer, prices, idempotency) still reach the real
 * checkout endpoint unchanged.
 *
 * State is the deterministic catalog from `manage.py seed_e2e_demo_data`:
 *   - store "default", WhatsApp configured
 *   - DeliveryRegion "Centro" -> fee R$ 5,00
 *   - Product "Produto Demo E2E" -> R$ 29,90, stock 25, NO variants
 */

const PRODUCT_NAME = 'Produto Demo E2E'
const EXPECTED_SUBTOTAL = '29.90'
const EXPECTED_FEE = '5.00'
const EXPECTED_TOTAL = '34.90'

function stubWindowOpen(): void {
  cy.window().then((win) => cy.stub(win, 'open').returns({}).as('windowOpen'))
}

describe('Checkout details validation (real backend)', () => {
  it('blocks an empty attempt, focuses the first invalid field, then completes with the same payload/values', () => {
    const phone = `1199${Date.now().toString().slice(-8)}`

    cy.intercept('GET', '**/api/v1/delivery-regions/active/').as('regions')
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/').as('checkout')

    cy.visit('/l/default/produtos')

    // 1. Search, add one unit to the cart.
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 })
      .find('[data-cy="add-to-cart-button"]')
      .click()

    // 2. Open the cart (step 1: review), continue to details.
    cy.get('[data-cy="open-cart-button"]', { timeout: 10000 }).click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('not.exist') // review step: no body summary yet
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()

    cy.wait('@regions').its('response.statusCode').should('eq', 200)

    // 3. Try to finish with nothing filled in. Delivery defaults to "Receber
    //    em casa" and the seeded store has an active region, so identity,
    //    region and address are all still missing.
    cy.get('@cart').find('[data-cy="checkout-submit-button"]')
      .should('be.enabled') // Ciclo 8: corrigible-only state never disables the CTA
      .as('submit')

    cy.get('@submit').click()

    // 4. General message + per-field messages + focus on the first invalid
    //    field (visual order: Nome).
    cy.get('@cart').contains('Revise os campos destacados.').should('be.visible')
    cy.get('@cart').contains('Informe seu nome.').should('be.visible')
    cy.get('@cart').contains('Informe seu telefone.').should('be.visible')
    cy.get('@cart').find('input[autocomplete="name"]').should('be.focused')
    cy.get('@checkout.all').should('have.length', 0)

    // 5. Fill in identity, pick the region, fill the address.
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Validacao')
    cy.get('@cart').find('input[autocomplete="tel"]').type(phone)
    cy.get('@cart').contains('label', 'Regiao de entrega').find('select').then(($select) => {
      const centro = [...$select[0].options].find((o) => /Centro/.test(o.textContent ?? ''))
      expect(centro, 'seeded "Centro" region option').to.exist
      cy.wrap($select).select((centro as HTMLOptionElement).value)
    })
    cy.get('@cart').find('input[autocomplete="street-address"]').type('Rua Validacao, 10')
    cy.get('@cart').find('input[autocomplete="address-level3"]').type('Centro')
    cy.get('@cart').find('input[autocomplete="address-level2"]').type('Salvador')

    // 6. Errors clear as the fields become valid; the summary reflects the
    //    resolved region fee.
    cy.get('@cart').contains('Informe seu nome.').should('not.exist')
    cy.get('@cart').contains('Selecione a região de entrega.').should('not.exist')
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', EXPECTED_SUBTOTAL.replace('.', ','))
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', EXPECTED_FEE.replace('.', ','))
    cy.get('@cart').find('footer').should('contain', EXPECTED_TOTAL.replace('.', ','))

    stubWindowOpen()

    // 7. Finalize -- same payload/value contract as the other real-backend specs.
    cy.get('@submit').click()
    cy.wait('@checkout').then(({ request, response }) => {
      expect(response?.statusCode).to.eq(200)
      expect(request.body.idempotency_key).to.be.a('string').and.not.be.empty
      const body = response?.body
      expect(body.order_reference).to.match(/^BPF-/)
      expect(body.subtotal).to.eq(EXPECTED_SUBTOTAL)
      expect(body.delivery_fee).to.eq(EXPECTED_FEE)
      expect(body.total).to.eq(EXPECTED_TOTAL)
      expect(body.customer.full_name).to.eq('Cliente Validacao')
      expect(body.customer.phone).to.eq(phone)
      expect(body.customer.delivery_region_name).to.eq('Centro')
      expect(body.customer.address).to.eq('Rua Validacao, 10')
      expect(body.whatsapp_url).to.match(/^https:\/\/wa\.me\//)
    })
    cy.get('@windowOpen').should('have.been.calledOnce')
  })
})
