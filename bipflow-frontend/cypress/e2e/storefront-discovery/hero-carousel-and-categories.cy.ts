/// <reference types="cypress" />
/**
 * Ciclo 9: hero carousel (multiple banners), promotions rail (single row,
 * never a grid) and the always-visible category nav -- against the real
 * backend, real store "default".
 *
 * The dev DB already carries at least one hero banner (migrated from the
 * legacy single-image field) and several promotion banners from earlier
 * manual QA; this spec only *adds* a second hero banner (for the multi-slide
 * assertions) and deletes exactly what it created in `after()`, leaving
 * everything else untouched.
 */

const apiBaseUrl = () =>
  String(Cypress.env('apiBaseUrl') || 'http://localhost:8000/api').replace(/\/$/, '')

function authHeaders() {
  const token = (Cypress.env('authTokens') as { access: string }).access
  return { Authorization: `Bearer ${token}` }
}

describe('Storefront discovery: hero carousel, promotions rail, category nav', () => {
  let createdHeroBannerId: number | null = null

  before(() => {
    cy.loginViaApi().then(() => {
      cy.request({
        method: 'POST',
        url: `${apiBaseUrl()}/v1/store/current/storefront-banners/`,
        headers: authHeaders(),
        body: {
          placement: 'hero',
          image_url: 'https://via.placeholder.com/1600x600.png?text=Hero+E2E',
          alt_text: 'Banner hero de teste E2E',
          title: 'Hero E2E',
          is_active: true,
        },
      }).then((response) => {
        expect(response.status).to.eq(201)
        createdHeroBannerId = response.body.id
      })
    })
  })

  after(() => {
    if (createdHeroBannerId !== null) {
      cy.request({
        method: 'DELETE',
        url: `${apiBaseUrl()}/v1/store/current/storefront-banners/${createdHeroBannerId}/`,
        headers: authHeaders(),
      })
    }
  })

  it('shows multiple hero banners and lets the shopper jump between them via the dots', () => {
    cy.visit('/l/default/produtos')

    cy.get('[data-cy="storefront-hero-banner"]', { timeout: 15000 }).should('exist')
    cy.get('[data-cy="storefront-hero-banner"] [role="tab"]').should('have.length.at.least', 2)

    // Only the active slide's caption renders (the others stay image-only,
    // v-show'd out) -- click through every dot and confirm the just-created
    // banner surfaces on at least one of them, and that each click actually
    // changes which dot is marked selected.
    cy.get('[data-cy="storefront-hero-banner"] [role="tab"]').then(($dots) => {
      const count = $dots.length
      let sawCreatedBanner = false

      for (let index = 0; index < count; index += 1) {
        cy.get('[data-cy="storefront-hero-banner"] [role="tab"]').eq(index).click()
        cy.get('[data-cy="storefront-hero-banner"] [role="tab"]')
          .eq(index)
          .should('have.attr', 'aria-selected', 'true')
        cy.get('[data-cy="storefront-hero-banner"]').then(($section) => {
          if ($section.text().includes('Hero E2E')) {
            sawCreatedBanner = true
          }
        })
      }

      cy.wrap(null).then(() => {
        expect(sawCreatedBanner, 'the newly created hero banner appeared on some slide').to.be.true
      })
    })
  })

  it('renders promotions in a single horizontally scrollable row, never a vertical grid', () => {
    cy.visit('/l/default/produtos')

    cy.get('[data-cy="storefront-promotional-banners"]', { timeout: 15000 }).should('exist')
    cy.get('[data-cy="storefront-promotional-banners"] [role="region"]')
      .should('have.css', 'display', 'flex')
      .and('have.css', 'overflow-x', 'auto')
  })

  it('filters by category from the always-visible nav, reflects it in the URL, and survives a reload', () => {
    cy.visit('/l/default/produtos')

    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip-all"]')
      .should('have.attr', 'aria-pressed', 'true')

    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
      .first()
      .invoke('text')
      .then((categoryName) => {
        cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]').first().click()

        cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)
        cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
          .first()
          .should('have.attr', 'aria-pressed', 'true')

        cy.reload()
        cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should(
          'contain',
          categoryName.trim(),
        )
        cy.location('search').should('match', /category=\d+/)
        cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
          .first()
          .should('have.attr', 'aria-pressed', 'true')
      })

    cy.get('[data-cy="storefront-category-chip-all"]').click()
    cy.location('search', { timeout: 10000 }).should('not.match', /category=\d+/)
  })

  it('visual audit: hero, promotions and category nav across required breakpoints, no horizontal overflow', () => {
    const viewports: Array<[number, number, string]> = [
      [360, 800, '360x800'],
      [390, 844, '390x844'],
      [768, 1024, '768x1024'],
      [1280, 900, '1280x900'],
      [1440, 900, '1440x900'],
    ]

    for (const [width, height, label] of viewports) {
      cy.viewport(width, height)
      cy.visit('/l/default/produtos')
      cy.get('[data-cy="storefront-hero-banner"]', { timeout: 15000 }).should('exist')
      cy.get('[data-cy="storefront-category-nav"]').should('exist')
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth, `${label}: no horizontal overflow`).to.be.at.most(
          doc.documentElement.clientWidth + 1,
        )
      })
      cy.screenshot(`ciclo9-${label}-home`, { capture: 'viewport' })

      // Category selected state.
      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]').first().click()
      cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)
      cy.screenshot(`ciclo9-${label}-category-selected`, { capture: 'viewport' })
    }
  })

  it('visual audit: reduced motion still renders the hero and promotions without autoplay artifacts', () => {
    cy.visit('/l/default/produtos', {
      onBeforeLoad(win) {
        cy.stub(win, 'matchMedia').callsFake((query: string) => ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }))
      },
    })

    cy.get('[data-cy="storefront-hero-banner"]', { timeout: 15000 }).should('exist')
    cy.get('[data-cy="storefront-hero-banner"]').should('not.contain', 'avancando automaticamente')
    cy.screenshot('ciclo9-reduced-motion-home', { capture: 'viewport' })
  })

  it('shows a category-aware empty state with "Ver todos os produtos" for a category with no visible products', () => {
    cy.intercept('GET', '**/api/v1/products/**', {
      statusCode: 200,
      body: { count: 0, next: null, previous: null, page_size: 12, total_pages: 0, results: [] },
    }).as('emptyCatalog')

    cy.visit('/l/default/produtos?category=999999')
    cy.wait('@emptyCatalog')

    cy.get('[data-cy="storefront-empty-state"]', { timeout: 15000 }).should('exist')
    cy.get('[data-cy="storefront-empty-state"]').contains('button', 'Ver todos os produtos').click()

    cy.location('search', { timeout: 10000 }).should('not.match', /category=\d+/)
  })
})
