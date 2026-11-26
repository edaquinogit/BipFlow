/// <reference types="cypress" />

describe('National shipping browser flow (stubbed quote and checkout)', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/v1/public/stores/default/shipping-quotes/', { enabled: true })
    cy.intercept('POST', '**/api/v1/public/stores/default/shipping-quotes/', {
      simulated: true, order_confirmation_available: true,
      quotes: [{ service: 'economico_simulado', price: '16.00', estimated_days: 4,
        provider: 'simulated', notice: 'Simulacao, nao oficial' }],
    }).as('quote')
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/', { statusCode: 422,
      body: { detail: 'Test fixture: no order created' } }).as('checkout')
    cy.visit('/l/default/produtos')
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type('Produto Demo E2E')
    cy.contains('article', 'Produto Demo E2E', { timeout: 15000 })
      .find('[data-cy="add-to-cart-button"]').click()
    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()
    cy.get('@cart').contains('label', 'Entrega').find('select').select('delivery')
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Nacional')
    cy.get('@cart').find('input[autocomplete="tel"]').type('79999999999')
    cy.get('@cart').find('input[autocomplete="street-address"]').type('Rua Teste, 10')
    cy.get('@cart').find('input[autocomplete="address-level3"]').type('Centro')
    cy.get('@cart').find('input[autocomplete="address-level2"]').type('Aracaju')
    cy.get('#shipping-preview-cep').type('49010000')
    cy.contains('button', /^Simular$/).click()
    cy.wait('@quote').its('request.body.destination_postal_code').should('eq', '49010000')
    cy.get('@cart').find('input[type="radio"][value="economico_simulado"]').check()
    cy.get('@cart').find('input[maxlength="2"]').type('SE')
    cy.contains('button', 'Usar frete simulado').click()
  })

  it('forwards the selected quote and displays the estimated total', () => {
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', '45,90')
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').click()
    cy.wait('@checkout').its('request.body').should(body => {
      expect(body.national_shipping).to.deep.equal({
        destination_postal_code: '49010000', state: 'SE',
        service: 'economico_simulado', expected_price: '16.00',
      })
      expect(body.customer.delivery_region_id).to.eq(null)
    })
  })

  it('blocks checkout after changing the destination CEP', () => {
    cy.get('#shipping-preview-cep').clear().type('40010000')
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').should('be.disabled')
    cy.get('@checkout.all').should('have.length', 0)
  })
})
