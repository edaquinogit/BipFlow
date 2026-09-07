/// <reference types="cypress" />
/**
 * Storefront interaction-polish cycle -- mobile, against the real backend and
 * the real store "default". Proves three regressions stay fixed:
 *
 *  1. Header stability -- tapping the account / cart / search / filter controls
 *     never costs the store its name and never resizes or shifts the header.
 *  2. Chip / control tap states never "stick" dark -- a just-tapped or
 *     just-deselected chip never keeps a dark fill, and a *selected* chip keeps
 *     a readable label (the :hover rule used to outrank .storefront-chip--on and
 *     paint the label in the fill colour -> invisible). A brief light press
 *     tint is allowed; a dark one is not.
 *  3. The filters bottom sheet leaves nothing behind -- closing it by the X
 *     removes the dialog node, unlocks body scroll and returns focus to the
 *     trigger, even after repeated open/close.
 *
 * These are CSS-and-DOM behaviours, only verifiable in a real browser at a real
 * touch viewport -- jsdom unit tests cover the class-binding / state side
 * (CategoryNav.spec / ProductsView.spec).
 */

const MOBILE_VIEWPORTS: Array<[number, number, string]> = [
  [320, 720, '320x720'],
  [375, 812, '375x812'],
  [390, 844, '390x844'],
  [430, 932, '430x932'],
]

// The store-name element is the last <span> in the brand lockup (the first span
// is the logo / initials wrapper). Bug #1 is about this span never collapsing.
const brandNameSpan = () => cy.get('.storefront-header .storefront-brand').first().find('span').last()

function visitStorefront(): void {
  cy.intercept('GET', '**/v1/store/current/').as('storeCurrent')
  cy.visit('/l/default/produtos', {
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
  cy.wait('@storeCurrent')
  cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
  // The header binds the store name off `selectedStore`, which is null on the
  // first paint and only resolves once the request above lands + Vue reacts.
  // Wait that out so tests read the real name, not the "Sua loja" fallback.
  brandNameSpan()
    .should('be.visible')
    .should(($span) => {
      const text = $span.text().trim()
      expect(text.length, 'store name resolved').to.be.greaterThan(2)
      expect(text, 'store name is not the generic fallback').not.to.eq('Sua loja')
    })
}

function rgbChannels(value: string): [number, number, number] {
  const match = value.match(/(\d+(?:\.\d+)?)/g)
  const [r = 0, g = 0, b = 0] = (match ?? []).map(Number)
  return [r, g, b]
}

function isDark(value: string): boolean {
  return rgbChannels(value).every((channel) => channel <= 60)
}

function colourDistance(a: string, b: string): number {
  const [ar, ag, ab] = rgbChannels(a)
  const [br, bg, bb] = rgbChannels(b)
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
}

describe('Storefront mobile interaction polish', () => {
  for (const [width, height, label] of MOBILE_VIEWPORTS) {
    it(`[${label}] the store name stays visible through every header interaction, with no layout shift`, () => {
      cy.viewport(width, height)
      visitStorefront()

      let storeName = ''
      brandNameSpan().invoke('text').then((text) => {
        storeName = text.trim()
        expect(storeName.length, 'a real store name renders on load').to.be.greaterThan(2)
        expect(storeName).not.to.eq('Sua loja')
      })

      cy.get('.storefront-header').first().then(($header) => {
        const initialHeight = $header[0].getBoundingClientRect().height

        const assertNameIntact = () => {
          // .should(cb) retries: a header control tap can kick a catalog
          // re-fetch that momentarily blanks `selectedStore` (pre-existing
          // behaviour). What must hold is that the name never collapses and
          // always settles back to the real store name.
          brandNameSpan().should(($span) => {
            expect($span[0].getBoundingClientRect().width, 'name never collapses to ~0 width').to.be.greaterThan(8)
            expect($span.text().trim(), 'name resolves back to the real store name').to.eq(storeName)
          })
          cy.get('.storefront-header').first().should(($h) => {
            expect(
              Math.abs($h[0].getBoundingClientRect().height - initialHeight),
              'header height unchanged',
            ).to.be.lessThan(2)
          })
        }

        // Account menu open + dismiss.
        cy.get('[aria-label="Entrar ou criar perfil"]').click()
        cy.get('[role="menu"]').should('be.visible')
        cy.get('body').click(5, 5)
        assertNameIntact()

        // Cart drawer open + close.
        cy.get('[data-cy="open-cart-button"]').click()
        cy.get('[role="dialog"][aria-label="Carrinho de pedido"]').should('be.visible')
        cy.get('[aria-label="Fechar carrinho"]').click()
        cy.get('[role="dialog"]').should('not.exist')
        assertNameIntact()

        // Filter trigger open + close.
        cy.get('[aria-label="Abrir filtros"]').click()
        cy.get('[aria-label="Fechar filtros"]').click()
        assertNameIntact()

        // Search field focus + type + clear, then repeated header taps.
        cy.get('input[aria-label="Buscar produtos por nome"]').click().type('a')
        cy.get('input[aria-label="Buscar produtos por nome"]').clear()
        cy.get('[aria-label="Entrar ou criar perfil"]').click().click()
        cy.get('body').click(5, 5)
        cy.get('[data-cy="open-cart-button"]').click()
        cy.get('[aria-label="Fechar carrinho"]').click()
        cy.get('[role="dialog"]').should('not.exist')
        assertNameIntact()
      })

      cy.document().then((doc) => {
        expect(
          doc.documentElement.scrollWidth,
          'no horizontal overflow after header interaction',
        ).to.be.at.most(doc.documentElement.clientWidth + 1)
      })
    })
  }

  it('a selected category chip keeps a readable label and no chip ever stays dark after a tap', () => {
    cy.viewport(390, 844)
    visitStorefront()

    const chips = () =>
      cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')

    chips().first().as('chipA')
    chips().eq(1).as('chipB')

    // Select chip A, lift the touch elsewhere, let any press transition settle.
    cy.get('@chipA').click({ force: true })
    cy.get('@chipA').should('have.attr', 'aria-pressed', 'true')
    cy.get('body').click(5, 5)
    cy.wait(300)

    cy.get('@chipA').should(($chip) => {
      const style = getComputedStyle($chip[0])
      // A selected chip's fill is dark by design -- but its label must NOT be
      // (bug #2: :hover repainted the label in the fill colour -> black on black).
      expect(isDark(style.backgroundColor), 'selected chip fill is the dark brand colour').to.eq(true)
      expect(isDark(style.color), 'selected chip label is NOT dark on dark').to.eq(false)
      expect(
        colourDistance(style.color, style.backgroundColor),
        'selected chip: label clearly contrasts its fill',
      ).to.be.greaterThan(120)
    })

    // No un-selected chip is left with a dark fill.
    chips().each(($el) => {
      if ($el.attr('aria-pressed') === 'true') return
      cy.wrap($el).should(($chip) => {
        expect(
          isDark(getComputedStyle($chip[0]).backgroundColor),
          `unselected chip "${$chip.text().trim()}" is not dark`,
        ).to.eq(false)
      })
    })

    // Switch to chip B: the selected look moves over, chip A goes back to a
    // light, un-selected fill (never keeps the dark pill).
    cy.get('@chipB').click({ force: true })
    cy.get('body').click(5, 5)
    cy.wait(300)
    cy.get('@chipA').should('have.attr', 'aria-pressed', 'false')
    cy.get('@chipA').should(($chip) => {
      expect(
        isDark(getComputedStyle($chip[0]).backgroundColor),
        'previously-selected chip is no longer dark',
      ).to.eq(false)
    })
    cy.get('@chipB').should(($chip) => {
      expect(isDark(getComputedStyle($chip[0]).color), 'new selected chip label is readable').to.eq(false)
    })
  })

  it('the filters sheet leaves no dialog, scroll lock or lost focus after the X closes it (even repeated)', () => {
    cy.viewport(390, 844)
    visitStorefront()

    for (let pass = 0; pass < 3; pass += 1) {
      cy.get('[aria-label="Abrir filtros"]').click()
      cy.get('[role="dialog"][aria-label="Filtrar produtos"]').should('be.visible')
      cy.get('body').should('have.css', 'overflow', 'hidden')

      cy.get('[aria-label="Fechar filtros"]').click()

      cy.get('[role="dialog"]').should('not.exist')
      cy.get('body').should('not.have.css', 'overflow', 'hidden')
      cy.get('[aria-label="Abrir filtros"]')
        .should('have.attr', 'aria-expanded', 'false')
        .and('be.focused')
    }

    // "Ver resultados" leaves the same clean slate.
    cy.get('[aria-label="Abrir filtros"]').click()
    cy.contains('[role="dialog"] button', 'Ver resultados').click()
    cy.get('[role="dialog"]').should('not.exist')
    cy.get('body').should('not.have.css', 'overflow', 'hidden')

    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth + 1)
    })
  })
})
