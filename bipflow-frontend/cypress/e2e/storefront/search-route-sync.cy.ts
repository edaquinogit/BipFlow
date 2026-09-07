/// <reference types="cypress" />
/**
 * BipFlow: storefront search ⇄ route synchronisation, against the REAL backend.
 *
 * Regression cover for the bug where typing in the catalog search box updated
 * the field and the URL but never issued a `GET /api/v1/products/?search=...`
 * (the debounced fetch was silently dropped), and where a stale route echo
 * arriving mid-typing could overwrite the term the customer had just typed --
 * so the catalog request went out truncated or with no `search` at all, which
 * intermittently broke `variant-pricing-smoke`, `critical-purchase-smoke` and
 * `checkout-details-validation`.
 *
 * State is the deterministic catalog from `manage.py seed_e2e_demo_data`:
 *   - store "default", category "Geral"
 *   - Product "Produto Demo E2E"      -> R$ 29,90
 *   - Product "Produto Variavel E2E"  -> R$ 50,00 (two colour variants)
 */

const SEARCH = 'input[aria-label="Buscar produtos por nome"]'

describe('Storefront search ⇄ route synchronisation (real backend)', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/v1/products/**').as('catalog')
    cy.visit('/l/default/produtos')
    cy.wait('@catalog') // initial unfiltered load
    cy.get(SEARCH, { timeout: 15000 }).should('be.visible')
  })

  it('sends the typed term to the backend and mirrors it in the URL', () => {
    cy.get(SEARCH).type('Produto Variavel E2E', { delay: 30 })

    cy.wait('@catalog').its('request.query.search').should('eq', 'Produto Variavel E2E')
    cy.location('search').should('include', 'search=Produto')

    // the request actually narrowed the catalog
    cy.contains('article', 'Produto Variavel E2E', { timeout: 10000 }).should('be.visible')
    cy.contains('article', 'Produto Demo E2E').should('not.exist')
  })

  it('a fast-typed term reaches the backend complete, never truncated or empty', () => {
    cy.get(SEARCH).type('Produto Demo E2E', { delay: 0 })

    cy.wait('@catalog').its('request.query.search').should('eq', 'Produto Demo E2E')
    cy.get(SEARCH).should('have.value', 'Produto Demo E2E')
    cy.location('search').should('include', 'search=Produto')

    // no late follow-up request drops the term again
    cy.wait(600)
    cy.get('@catalog.all').then((calls) => {
      const withSearch = (calls as unknown as Array<{ request: { query: Record<string, string> } }>)
        .filter((c) => 'search' in c.request.query)
      const last = withSearch[withSearch.length - 1]
      expect(last.request.query.search).to.eq('Produto Demo E2E')
    })
  })

  it('clearing the search drops only ?search from the URL and the request', () => {
    cy.get(SEARCH).type('Produto Variavel E2E', { delay: 30 })
    cy.wait('@catalog').its('request.query.search').should('eq', 'Produto Variavel E2E')
    cy.get('article').should('have.length', 1) // narrowed to the single match

    cy.get(SEARCH).clear()

    cy.wait('@catalog').its('request.query').should('not.have.property', 'search')
    cy.location('search').should('not.include', 'search=')
    // catalog widened back out -- the term was the ONLY thing removed
    cy.get('article').should('have.length.greaterThan', 1)
  })

  it('search and category filter coexist in the URL and the request', () => {
    // apply a category through the filters sheet
    cy.get('[aria-label="Abrir filtros"]').first().click()
    cy.contains('button', 'Geral').click()
    cy.contains('button', 'Ver resultados').click()
    cy.wait('@catalog').its('request.query.category').should('be.a', 'string')

    cy.get(SEARCH).type('Produto', { delay: 30 })

    cy.wait('@catalog').then(({ request }) => {
      expect(request.query.search).to.eq('Produto')
      expect(request.query.category, 'category kept alongside search').to.be.a('string')
    })
    cy.location('search').should('include', 'search=Produto')
    cy.location('search').should('include', 'category=')
  })

  it('reload restores both search and category from the URL', () => {
    cy.get('[aria-label="Abrir filtros"]').first().click()
    cy.contains('button', 'Geral').click()
    cy.contains('button', 'Ver resultados').click()
    cy.wait('@catalog')
    cy.get(SEARCH).type('Demo', { delay: 30 })
    cy.wait('@catalog')

    cy.location('search').then((search) => {
      cy.reload()
      cy.wait('@catalog').then(({ request }) => {
        expect(request.query.search).to.eq('Demo')
        expect(request.query.category).to.be.a('string')
      })
      cy.get(SEARCH).should('have.value', 'Demo')
      cy.location('search').should('eq', search)
    })
  })
})
