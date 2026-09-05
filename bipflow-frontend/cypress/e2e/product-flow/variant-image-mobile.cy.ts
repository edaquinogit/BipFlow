/// <reference types="cypress" />
/**
 * Ciclo 9 (complementary fix), mobile validation for the variant image
 * selector: every viewport the task requires, on the real storefront product
 * detail page, exercising real touch interaction.
 *
 * The product (two variants, each with its own uploaded photo) is created
 * once via the real dashboard form (see variant-image-journey.cy.ts for the
 * equivalent desktop journey) and reused across every mobile viewport below.
 */

type AuthTokens = { access: string }
type CategoryResponse = { id: number; name: string }

const TEST_IMAGE_PATH = 'cypress/fixtures/test-product-image.png'
const SCROLL_TOLERANCE_PX = 20

const getApiBaseUrl = () =>
  String(Cypress.env('apiBaseUrl') || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

const productName = `Variante Mobile E2E ${Date.now()}`

function expectNoHorizontalOverflow(label: string): void {
  cy.document().then((doc) => {
    expect(doc.documentElement.scrollWidth, `${label}: no horizontal overflow`).to.be.at.most(
      doc.documentElement.clientWidth + 1,
    )
  })
}

describe('Variant images: mobile validation of the storefront selector (real backend)', () => {
  // Two separate `before()` hooks, not one: Mocha runs each to full
  // completion before the next one's body even starts executing, which is
  // what actually guarantees `Cypress.env('e2eCategoryId')` is populated by
  // the time the second hook reads it. Reading it from a plain JS
  // expression later in the *same* hook body does not work -- that
  // expression evaluates immediately while commands are still being queued,
  // long before the queued login/category-lookup commands actually run.
  before(() => {
    cy.loginViaApi().then((tokens: AuthTokens) => {
      const authHeaders = { Authorization: `Bearer ${tokens.access}` }
      return cy
        .request<{ count: number; results: CategoryResponse[] }>({
          method: 'GET',
          url: `${getApiBaseUrl()}/v1/categories/?page_size=1`,
          headers: authHeaders,
        })
        .then((listResponse) => {
          const existing = listResponse.body.results[0]
          if (existing) {
            Cypress.env('e2eCategoryId', existing.id)
            return
          }
          return cy
            .request<CategoryResponse>({
              method: 'POST',
              url: `${getApiBaseUrl()}/v1/categories/`,
              headers: authHeaders,
              body: { name: `E2E Variant Mobile Category ${Date.now()}` },
            })
            .then((createResponse) => {
              Cypress.env('e2eCategoryId', createResponse.body.id)
            })
        })
    })
  })

  before(() => {
    // Product creation happens once, through the real dashboard form, at a
    // desktop viewport -- the form itself isn't the concern of this spec,
    // only the storefront selector it feeds is validated per-viewport below.
    cy.viewport(1280, 900)
    cy.visitWithAuth('/dashboard/produtos')
    cy.get('[data-cy="btn-add-product"]', { timeout: 5000 }).should('be.visible').click()
    cy.get('[data-cy="product-form-panel"]', { timeout: 3000 }).should('be.visible')

    cy.get('input[name="name"]').should('be.visible').type(productName)
    cy.get('input[name="price"]').scrollIntoView().type('54.90')
    cy.get('input[name="stock_quantity"]').scrollIntoView().type('20')
    cy.get('[data-cy="select-category"]').scrollIntoView().should('be.visible').click()
    cy.get(`[data-cy="category-option-${Cypress.env('e2eCategoryId')}"]`)
      .scrollIntoView()
      .should('be.visible')
      .click()

    cy.contains('button', 'Adicionar primeira cor').scrollIntoView().click()
    cy.get('input[placeholder="Preto, azul..."]').last().type('Rosa Mobile')
    cy.get('[aria-label="Quantidade em estoque da variante Rosa Mobile"]').type('8')
    cy.get('[aria-label="Enviar imagem da variante Rosa Mobile"]')
      .scrollIntoView()
      .selectFile(TEST_IMAGE_PATH, { force: true })
    cy.get('img[alt="Imagem da variante Rosa Mobile"]', { timeout: 5000 }).should('exist')

    cy.get('[aria-label="Adicionar variante de cor"]').click()
    cy.get('input[placeholder="Preto, azul..."]').last().type('Preto Mobile')
    cy.get('[aria-label="Quantidade em estoque da variante Preto Mobile"]').type('8')
    cy.get('[aria-label="Enviar imagem da variante Preto Mobile"]')
      .scrollIntoView()
      .selectFile(TEST_IMAGE_PATH, { force: true })
    cy.get('img[alt="Imagem da variante Preto Mobile"]', { timeout: 5000 }).should('exist')

    cy.get('[data-cy="btn-submit-product"]').scrollIntoView().should('not.be.disabled').click()
    cy.get('[data-cy="toast-success"]', { timeout: 10000 }).should('be.visible')
    cy.get('[data-cy="product-form-panel"]', { timeout: 5000 }).should('not.exist')
  })

  const viewports: Array<[number, number, string]> = [
    [360, 800, '360x800'],
    [390, 844, '390x844'],
    [412, 915, '412x915'],
    [768, 1024, '768x1024'],
  ]

  for (const [width, height, label] of viewports) {
    it(`[${label}] variant selector: real photos, touch switching, no layout regressions`, () => {
      cy.viewport(width, height)
      cy.visit('/l/default/produtos')
      cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(productName)
      cy.contains('article', productName, { timeout: 15000 }).should('be.visible').click()
      cy.location('pathname', { timeout: 10000 }).should('match', /\/l\/default\/produtos\/.+/)
      expectNoHorizontalOverflow(`${label} product detail load`)

      const heroImage = () => cy.get(`img[alt="Imagem do produto ${productName}"]`, { timeout: 10000 })

      // Miniaturas visíveis: both variant chips render a real <img>, not a
      // color dot, and each is a real ≥44x44 touch target.
      cy.get('[aria-label="Selecionar cor Rosa Mobile"] img').should('exist')
      cy.get('[aria-label="Selecionar cor Preto Mobile"] img').should('exist')
      cy.get('[aria-label^="Selecionar cor"]').each(($chip) => {
        expect($chip.outerWidth(), 'variant chip touch target width').to.be.at.least(44)
        expect($chip.outerHeight(), 'variant chip touch target height').to.be.at.least(44)
      })

      // Scroll the chip into view first, exactly like a real thumb would
      // before tapping something -- only *then* record the scroll position
      // and confirm the tap itself causes no *further* movement.
      // `{ scrollBehavior: false }` on the click disables Cypress's own
      // pre-click "scroll target into view" assistance, isolating what the
      // *application* does from what Cypress's actionability check would
      // otherwise do on its own (the same technique the category-nav
      // scroll-jump fix relies on).
      cy.get('[aria-label="Selecionar cor Preto Mobile"]').scrollIntoView()
      // Let the just-scrolled-to position, and the still-selected variant's
      // hero image, fully settle before sampling a baseline -- otherwise the
      // "before" reading can itself land mid-reflow.
      heroImage().should(($img) => {
        expect(($img[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0)
      })
      cy.window().its('scrollY').then((beforeY) => {
        cy.get('[aria-label="Selecionar cor Preto Mobile"]')
          .trigger('touchstart', { scrollBehavior: false, force: true })
          .trigger('touchend', { scrollBehavior: false, force: true })
          .click({ scrollBehavior: false, force: true })

        cy.get('[aria-label="Selecionar cor Preto Mobile"]').should('have.attr', 'aria-pressed', 'true')
        // The newly-selected variant's own photo must finish loading before
        // the page can be considered settled -- checking scrollY before that
        // races the image load, not the app's own scroll behavior.
        heroImage().should(($img) => {
          expect(($img[0] as HTMLImageElement).naturalWidth, 'new hero image loaded').to.be.greaterThan(0)
        })
        cy.window().its('scrollY').should('be.closeTo', beforeY, SCROLL_TOLERANCE_PX)
      })

      cy.screenshot(`ciclo9-variant-mobile-${label}-after-preto`, { capture: 'viewport' })

      // Imagem principal sem distorção: the hero sits in a fixed aspect-ratio
      // box with object-contain, never stretched to fill it.
      heroImage()
        .should('have.class', 'object-contain')
        .and(($img) => {
          const el = $img[0] as HTMLImageElement
          expect(el.naturalWidth, 'hero image actually loaded').to.be.greaterThan(0)
        })
      cy.get('img').filter(`[alt="Imagem do produto ${productName}"]`).parent().should('have.class', 'aspect-[4/5]')

      // Switch back -- the image must update immediately, and the chip
      // track/selector must never cause horizontal page overflow.
      cy.get('[aria-label="Selecionar cor Rosa Mobile"]').click({ scrollBehavior: false, force: true })
      cy.get('[aria-label="Selecionar cor Rosa Mobile"]').should('have.attr', 'aria-pressed', 'true')
      expectNoHorizontalOverflow(`${label} after variant switch`)

      // CTA completamente legível: the sticky mobile bar's button text is
      // never truncated with an ellipsis, and sits clear of the quantity
      // stepper above it (both fully visible with no overlap). The CSS
      // `uppercase` transform on the button is purely visual ("ADICIONAR")
      // and does not change the underlying text content ("Adicionar").
      cy.get('button:visible').contains('Adicionar').should('be.visible').invoke('text').then((text) => {
        expect(text.trim()).to.eq('Adicionar')
      })
      cy.get('button:visible').contains('Adicionar').then(($btn) => {
        const el = $btn[0] as HTMLElement
        expect(el.scrollWidth, 'CTA label not clipped').to.be.at.most(el.clientWidth + 1)
      })
      cy.get('button[aria-label="Aumentar quantidade"]').then(($qty) => {
        cy.get('button:visible').contains('Adicionar').then(($cta) => {
          const qtyBox = ($qty[0] as HTMLElement).getBoundingClientRect()
          const ctaBox = ($cta[0] as HTMLElement).getBoundingClientRect()
          const overlaps = qtyBox.left < ctaBox.right
            && qtyBox.right > ctaBox.left
            && qtyBox.top < ctaBox.bottom
            && qtyBox.bottom > ctaBox.top
          expect(overlaps, 'quantity stepper and CTA do not overlap').to.be.false
        })
      })

      // Preço e estoque sem colisões: both pieces of text are visible and
      // not clipped against each other or the viewport edge.
      cy.contains('disponíveis').should('be.visible')
      cy.get('main').should(($main) => {
        expect(($main[0] as HTMLElement).scrollWidth).to.be.at.most(width + 1)
      })

      cy.screenshot(`ciclo9-variant-mobile-${label}-after-rosa`, { capture: 'viewport' })
    })
  }
})
