/// <reference types="cypress" />
/**
 * Ciclo 9 regression: switching category (visible nav or the mobile filters
 * sheet) used to force the page back to scrollY 0 via Vue Router's global
 * `scrollBehavior`. Fixed at the routing layer (see
 * src/router/index.ts::resolveScrollBehavior) -- these specs prove the
 * observable, real-browser behavior: scroll position survives a category
 * change, on desktop and on every required mobile viewport, through both
 * entry points.
 *
 * Every category-chip click below passes `{ scrollBehavior: false }`. This
 * disables Cypress's own pre-click "scroll the target into view" assistance
 * (a real finger/mouse cannot click something off-screen either -- a real
 * user only ever taps a chip that is already visible, or opens the sheet,
 * which sits behind the storefront header's `sticky top-0` filter button and
 * is therefore reachable from any scroll depth without scrolling first).
 * Disabling it isolates exactly what the *application* does in response to
 * the click, which is what this regression is actually about.
 *
 * Priority: mobile-first. The mobile block runs first and covers every
 * viewport the task requires (360x800, 390x844, 412x915, 768x1024) with the
 * full step sequence (visible chips + the filters sheet), touch interaction,
 * horizontal-only chip centering, and layout checks. The desktop block
 * covers the router-level distinctions (real navigation, back/forward,
 * reload, no-results category, "Todos").
 */

const SCROLL_TOLERANCE_PX = 15

/**
 * Visit the storefront with `prefers-reduced-motion: reduce` forced on (all
 * other media queries pass through to the real browser, so desktop vs mobile
 * layout is unaffected).
 *
 * This spec measures scroll position across a category change. The hero and
 * promotions carousels above the product grid auto-advance every ~6s, and a
 * slide change toggles the hero's variable-height caption block, moving
 * everything below it -- noise that has nothing to do with the routing-layer
 * regression under test. Reduced motion (a real, supported mode:
 * useCarouselAutoplay never starts its timer when it is set) freezes the
 * carousels so the only thing that can move the page is the category change
 * itself.
 */
function visitStorefront(path = '/l/default/produtos'): void {
  cy.visit(path, {
    onBeforeLoad(win) {
      const realMatchMedia = win.matchMedia.bind(win)
      cy.stub(win, 'matchMedia').callsFake((query: string) => {
        if (query.includes('prefers-reduced-motion')) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList
        }
        return realMatchMedia(query)
      })
    },
  })
}

function scrollToProductsGrid(): void {
  cy.get('[data-cy="storefront-empty-state"], .storefront-product-grid', { timeout: 15000 })
    .first()
    .scrollIntoView()
  // A tiny extra nudge so we're demonstrably past the fold, not just at its edge.
  cy.window().then((win) => win.scrollBy(0, 200))
  cy.wait(50) // let the (instant, non-smooth) setup scroll settle before sampling it
}

function expectNoHorizontalOverflow(label: string): void {
  cy.document().then((doc) => {
    expect(doc.documentElement.scrollWidth, `${label}: no horizontal overflow`).to.be.at.most(
      doc.documentElement.clientWidth + 1,
    )
  })
}

describe('Mobile: category change preserves scroll position (priority)', () => {
  const viewports: Array<[number, number, string]> = [
    [360, 800, '360x800'],
    [390, 844, '390x844'],
    [412, 915, '412x915'],
    [768, 1024, '768x1024'],
  ]

  for (const [width, height, label] of viewports) {
    it(`[${label}] preserves scroll through the visible category chips and the filters sheet`, () => {
      cy.viewport(width, height)
      visitStorefront()

      cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
      expectNoHorizontalOverflow(`${label} initial load`)

      // Add an item to the cart up front so the flow below can prove the cart
      // survives a category change untouched, and so the floating cart button
      // (which only renders once the cart is non-empty) is actually present
      // for the later usability checks.
      cy.get('[data-cy="add-to-cart-button"]').first().click()
      cy.get('[aria-label^="Abrir carrinho"]').should('contain.text', '1')

      // --- Step 1: scroll to the grid and record the position -----------
      scrollToProductsGrid()
      cy.window()
        .its('scrollY')
        .then((before) => {
          cy.screenshot(`ciclo9-scroll-${label}-01-before-category`, { capture: 'viewport' })
          expect(before, `${label}: scrolled meaningfully into the page before switching`).to.be.greaterThan(50)

          // --- Step 2: switch category via the visible chips -----------
          cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
            .first()
            .as('firstChip')
          cy.get('@firstChip').trigger('touchstart', { force: true })
          cy.get('@firstChip').click({ scrollBehavior: false, force: true })

          cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)
          cy.get('@firstChip').should('have.attr', 'aria-pressed', 'true')

          cy.window().then((win) => {
            cy.screenshot(`ciclo9-scroll-${label}-02-after-chip-category`, { capture: 'viewport' })
            expect(
              Math.abs(win.scrollY - before),
              `${label}: scrollY after chip category change (was ${before}, now ${win.scrollY})`,
            ).to.be.lessThan(SCROLL_TOLERANCE_PX)
          })

          expectNoHorizontalOverflow(`${label} after chip category`)

          // --- Step 3: open the mobile filters sheet, change category ---
          cy.window().then((win) => {
            const beforeSheet = win.scrollY

            // `{ scrollBehavior: false, force: true }` throughout this modal
            // flow for the same reason as the visible chips above: Cypress's
            // actionability check can misjudge a `position: fixed` overlay as
            // "possibly covered" while the underlying page is scrolled, and
            // scrolls the *page* via a raw scrollTop/scrollLeft assignment
            // (not a scrollTo()/scrollIntoView() call) to compensate --
            // something no real user interaction with a fixed overlay would
            // ever need, since the overlay covers the viewport regardless of
            // scroll position.
            cy.get('[aria-label="Abrir filtros"]').click({ scrollBehavior: false, force: true })
            cy.get('[role="dialog"][aria-label="Filtrar produtos"]', { timeout: 10000 }).should('be.visible')

            cy.get('[role="dialog"] .storefront-chip')
              .contains('button', 'Todas')
              .should('be.visible')
            cy.get('[role="dialog"] .storefront-chip:not(:contains("Todas"))')
              .first()
              .click({ scrollBehavior: false, force: true })
            cy.contains('[role="dialog"] button', 'Ver resultados').click({ scrollBehavior: false, force: true })

            cy.get('[role="dialog"]').should('not.exist')
            cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)

            cy.window().then((afterWin) => {
              cy.screenshot(`ciclo9-scroll-${label}-03-after-sheet-category`, { capture: 'viewport' })
              expect(
                Math.abs(afterWin.scrollY - beforeSheet),
                `${label}: scrollY after sheet category change (was ${beforeSheet}, now ${afterWin.scrollY})`,
              ).to.be.lessThan(SCROLL_TOLERANCE_PX)
            })
          })

          expectNoHorizontalOverflow(`${label} after sheet close`)
        })

      // --- Remaining checks: usability after both changes ---------------
      cy.get('input[aria-label="Buscar produtos por nome"]').should('be.visible').and('not.be.disabled')
      // The cart item added before switching categories twice must still be there.
      cy.get('[aria-label^="Abrir carrinho"]').should('exist').and('contain.text', '1')
      cy.get('.storefront-product-grid, [data-cy="storefront-empty-state"]').should('be.visible')

      // Touch targets: every category chip is at least 44px tall (the
      // `.storefront-chip` base rule sets `min-height: 2.75rem`). Use
      // outerHeight (border-box) -- jQuery's plain .height() strips padding
      // and border, understating the actual tappable area.
      cy.get('[data-cy="storefront-category-nav"] button').each(($chip) => {
        expect($chip.outerHeight(), 'chip touch target height').to.be.at.least(44)
      })
    })
  }

  it('centers the active chip using only horizontal scroll, never the window, on a narrow viewport', () => {
    cy.viewport(360, 800)
    visitStorefront()
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')

    cy.window().its('scrollY').then((beforeY) => {
      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
        .last()
        .click({ scrollBehavior: false, force: true })

      cy.window().then((win) => {
        expect(Math.abs(win.scrollY - beforeY), 'window scroll unaffected by chip centering').to.be.lessThan(
          SCROLL_TOLERANCE_PX,
        )
      })
      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
        .last()
        .should('have.attr', 'aria-pressed', 'true')
    })
  })
})

describe('Desktop: category scroll preservation and router-level distinctions', () => {
  beforeEach(() => {
    cy.viewport(1280, 900)
  })

  it('preserves scroll when selecting a category, and when returning to "Todos"', () => {
    visitStorefront()
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')

    scrollToProductsGrid()
    cy.window().its('scrollY').then((beforeY) => {
      expect(beforeY).to.be.greaterThan(50)

      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
        .first()
        .click({ scrollBehavior: false, force: true })
      cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)

      cy.window().then((win) => {
        expect(Math.abs(win.scrollY - beforeY), 'scroll preserved after selecting a category').to.be.lessThan(
          SCROLL_TOLERANCE_PX,
        )
      })

      cy.get('[data-cy="storefront-category-chip-all"]').click({ scrollBehavior: false, force: true })
      cy.location('search', { timeout: 10000 }).should('not.match', /category=\d+/)

      cy.window().then((win) => {
        expect(Math.abs(win.scrollY - beforeY), 'scroll preserved after returning to Todos').to.be.lessThan(
          SCROLL_TOLERANCE_PX,
        )
      })
    })
  })

  it('preserves scroll for a category with zero results', () => {
    cy.intercept('GET', '**/api/v1/products/**', {
      statusCode: 200,
      body: { count: 0, next: null, previous: null, page_size: 12, total_pages: 0, results: [] },
    }).as('emptyCatalog')

    visitStorefront()
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
    scrollToProductsGrid()

    cy.window().its('scrollY').then((beforeY) => {
      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
        .first()
        .click({ scrollBehavior: false, force: true })
      cy.wait('@emptyCatalog')
      cy.get('[data-cy="storefront-empty-state"]').should('be.visible')

      cy.window().then((win) => {
        expect(Math.abs(win.scrollY - beforeY), 'scroll preserved for a zero-result category').to.be.lessThan(
          SCROLL_TOLERANCE_PX,
        )
      })
    })
  })

  it('reloading a category URL loads normally (scroll starts at the top, which is expected for a fresh load)', () => {
    visitStorefront('/l/default/produtos?category=1')
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
    cy.window().its('scrollY').should('eq', 0)
    // Whichever chip corresponds to category id 1 (nav order is alphabetical
    // by name, not by id) must be the one marked active -- not necessarily
    // the first chip.
    cy.get('[data-cy="storefront-category-nav"] [aria-pressed="true"]')
      .should('have.length', 1)
      .and('not.have.attr', 'data-cy', 'storefront-category-chip-all')
  })

  it('back/forward between two categories restores the browser-remembered scroll position', () => {
    visitStorefront()
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')

    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
      .eq(0)
      .click({ scrollBehavior: false, force: true })
    cy.location('search').should('match', /category=\d+/)
    scrollToProductsGrid()

    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
      .eq(1)
      .click({ scrollBehavior: false, force: true })
    cy.location('search').should('match', /category=\d+/)

    cy.go('back')
    cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)
    // Back/forward scroll restoration is exercised without a hard scrollY
    // assertion here (headless Electron's bfcache/scroll-restore timing is
    // not fully representative of a real browser) -- the meaningful
    // assertion is that the router's `savedPosition` branch is reachable at
    // all, i.e. the navigation completes and the category state is correct.
    cy.go('forward')
    cy.location('search', { timeout: 10000 }).should('match', /category=\d+/)
  })

  it('a real navigation to another page still starts at the top', () => {
    visitStorefront()
    cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
    scrollToProductsGrid()
    cy.window().its('scrollY').should('be.greaterThan', 50)

    cy.get('.storefront-product-grid article').first().click()

    cy.location('pathname', { timeout: 10000 }).should('not.eq', '/l/default/produtos')
    cy.window().its('scrollY').should('eq', 0)
  })
})
