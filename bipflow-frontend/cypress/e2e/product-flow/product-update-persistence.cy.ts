/// <reference types="cypress" />
/**
 * Regression: a product edit saved from the dashboard must survive a full
 * page reload and a fresh API GET -- covers the "I changed it, it looked
 * saved, then reverted on reload" bug, including the clear-a-text-field case
 * that was silently dropped in useProducts._preparePayload.
 *
 * A freshly-created product sorts first (Product.Meta.ordering = -created_at),
 * so it is always the first dashboard row -- no search/debounce needed.
 */
const API = Cypress.env('apiBaseUrl') || 'http://localhost:8000/api'

describe('product update persistence', () => {
  let token: string
  let productId: number
  const original = `REPRO ORIG ${Date.now()}`
  const edited = `${original} EDIT`

  before(() => {
    cy.loginViaApi().then((t) => {
      token = t.access
      return cy.request({
        method: 'GET',
        url: `${API}/v1/categories/`,
        headers: { Authorization: `Bearer ${token}` },
      })
    }).then((res) => {
      const catId = res.body.results[0].id
      return cy.request({
        method: 'POST',
        url: `${API}/v1/products/`,
        headers: { Authorization: `Bearer ${token}` },
        form: true,
        body: {
          name: original,
          description: 'descricao original',
          price: '10.00',
          stock_quantity: '9',
          size: 'P',
          category: catId,
          low_stock_threshold: '',
        },
      })
    }).then((res) => {
      productId = res.body.id
      cy.log(`test product id=${productId}`)
    })
  })

  after(() => {
    if (productId) {
      cy.request({
        method: 'DELETE',
        url: `${API}/v1/products/${productId}/`,
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
    }
  })

  const openRowEditor = (rowName: string) => {
    cy.contains('[data-cy="product-table-row"]', rowName, { timeout: 15000 })
      .find('[title="Editar produto"]')
      .click({ force: true })
    cy.get('[data-cy="product-form-panel"]', { timeout: 8000 }).should('be.visible')
  }

  it('persists a name + description edit across a full page reload', () => {
    cy.intercept('PATCH', '**/api/v1/products/*/').as('patch')

    cy.loginViaApi()
    cy.visitWithAuth('/dashboard/produtos')

    openRowEditor(original)
    cy.get('[data-cy="input-product-name"]').should('have.value', original)

    cy.get('[data-cy="input-product-name"]').clear().type(edited)
    cy.get('[data-cy="input-product-description"]').clear().type('descricao EDITADA')
    cy.get('[data-cy="btn-submit-product"]').scrollIntoView().should('not.be.disabled').click()

    cy.wait('@patch').then(({ response }) => {
      expect(response?.statusCode, 'PATCH status').to.eq(200)
      expect(response?.body?.name, 'PATCH response name').to.eq(edited)
      expect(response?.body?.description, 'PATCH response description').to.eq('descricao EDITADA')
    })

    cy.get('[data-cy="product-form-panel"]', { timeout: 8000 }).should('not.exist')

    // ================= HARD RELOAD =================
    cy.reload()

    cy.contains('[data-cy="product-table-row"]', edited, { timeout: 15000 })
      .find('[title="Editar produto"]')
      .click({ force: true })
    cy.get('[data-cy="product-form-panel"]', { timeout: 8000 }).should('be.visible')

    // THE ASSERTION -- did the edit survive the reload?
    cy.get('[data-cy="input-product-name"]').should('have.value', edited)
    cy.get('[data-cy="input-product-description"]').should('have.value', 'descricao EDITADA')

    // independent proof straight from the API / DB
    cy.request({
      method: 'GET',
      url: `${API}/v1/products/${productId}/`,
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => {
      expect(res.body.name, 'fresh GET name').to.eq(edited)
      expect(res.body.description, 'fresh GET description').to.eq('descricao EDITADA')
    })
  })

  it('clearing the description + size persists across a reload', () => {
    cy.intercept('PATCH', '**/api/v1/products/*/').as('patch')
    cy.loginViaApi()
    cy.visitWithAuth('/dashboard/produtos')

    openRowEditor(edited)
    cy.get('[data-cy="input-product-description"]').should('not.have.value', '')
    cy.get('[data-cy="input-product-description"]').clear()
    cy.get('[data-cy="btn-submit-product"]').scrollIntoView().should('not.be.disabled').click()

    cy.wait('@patch').its('response.statusCode').should('eq', 200)
    cy.get('[data-cy="product-form-panel"]', { timeout: 8000 }).should('not.exist')

    // fresh GET straight from the API/DB
    cy.request({
      method: 'GET',
      url: `${API}/v1/products/${productId}/`,
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => {
      expect(res.body.description, 'description after clearing + save').to.eq('')
    })

    // and it must still read as empty after a full reload of the dashboard
    cy.reload()
    openRowEditor(edited)
    cy.get('[data-cy="input-product-description"]').should('have.value', '')
  })
})
