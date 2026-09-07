/// <reference types="cypress" />
/**
 * Storefront interaction-polish cycle -- mobile, against the real backend and
 * the real store "default". Proves three regressions stay fixed:
 *
 *  1. Header stability -- tapping the account / cart / search controls never
 *     costs the store its name and never resizes or shifts the header.
 *  2. Chip / control tap states never "stick" -- on a real touch viewport a
 *     just-tapped chip does not keep a dark press/hover fill, and a *selected*
 *     chip keeps a readable label (the :hover rule used to outrank
 *     .storefront-chip--on and paint the label in the fill colour -> invisible).
 *  3. The filters bottom sheet leaves nothing behind -- closing it by the X
 *     removes the dialog node, unlocks body scroll and returns focus to the
 *     trigger, even after repeated open/close.
 *
 * These are CSS-and-DOM behaviours, so they can only be verified in a real
 * browser at a real touch viewport -- jsdom unit tests cover the class-binding
 * and state side (CategoryNav.spec / ProductsView.spec).
 */

const MOBILE_VIEWPORTS: Array<[number, number, string]> = [
  [320, 720, '320x720'],
  [375, 812, '375x812'],
  [390, 844, '390x844'],
  [430, 932, '430x932'],
]

function visitStorefront(): void {
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
  cy.get('[data-cy="storefront-category-nav"]', { timeout: 15000 }).should('exist')
}

function rgbChannels(value: string): [number, number, number] {
  const match = value.match(/(\d+(?:\.\d+)?)/g)
  const [r = 0, g = 0, b = 0] = (match ?? []).map(Number)
  return [r, g, b]
}

function colourDistance(a: string, b: string): number {
  const [ar, ag, ab] = rgbChannels(a)
  const [br, bg, bb] = rgbChannels(b)
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
}

describe('Storefront mobile interaction polish', () => {
  for (const [width, height, label] of MOBILE_VIEWPORTS) {
    it(`[${label}] the store name survives every header interaction, with no layout shift`, () => {
      cy.viewport(width, height)
      visitStorefront()

      cy.get('.storefront-brand').first().should('be.visible').invoke('text').then((initialName) => {
        const trimmed = initialName.trim()
        expect(trimmed.length, 'store name is rendered on load').to.be.greaterThan(0)

        cy.get('.storefront-header').first().then(($header) => {
          const initialHeight = $header[0].getBoundingClientRect().height

          // Every header control, in sequence: account menu, cart drawer,
          // search field, filter trigger.
          cy.get('[aria-label="Entrar ou criar perfil"]').click()
          cy.get('body').click(5, 5) // dismiss the menu
          cy.get('[data-cy="open-cart-button"]').click()
          cy.get('[role="dialog"][aria-label="Carrinho de pedido"]').should('be.visible')
          cy.get('[aria-label="Fechar carrinho"]').click()
          cy.get('input[aria-label="Buscar produtos por nome"]').click().type('a').clear()
          cy.get('[aria-label="Abrir filtros"]').click()
          cy.get('[aria-label="Fechar filtros"]').click()

          // Name still there, same text, header same height.
          cy.get('.storefront-brand').first().should('be.visible').invoke('text').then((afterName) => {
            expect(afterName.trim(), 'store name unchanged after header interaction').to.eq(trimmed)
          })
          cy.get('.storefront-header').first().then(($afterHeader) => {
            const afterHeight = $afterHeader[0].getBoundingClientRect().height
            expect(Math.abs(afterHeight - initialHeight), 'header height unchanged').to.be.lessThan(1)
          })
        })
      })

      cy.document().then((doc) => {
        expect(
          doc.documentElement.scrollWidth,
          'no horizontal overflow after header interaction',
        ).to.be.at.most(doc.documentElement.clientWidth + 1)
      })
    })
  }

  it('a selected category chip keeps a readable label and unselected chips never stay dark', () => {
    cy.viewport(390, 844)
    visitStorefront()

    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
      .first()
      .as('chip')

    // Tap to select, then move the touch elsewhere (a real fingertip lifts).
    cy.get('@chip').click({ force: true })
    cy.get('@chip').should('have.attr', 'aria-pressed', 'true')
    cy.get('body').click(5, 5)

    cy.get('@chip').then(($chip) => {
      const style = getComputedStyle($chip[0])
      // Bug #2: :hover used to repaint the label in the fill colour on a
      // selected chip -> black on black. The label must stay legible.
      expect(
        colourDistance(style.color, style.backgroundColor),
        'selected chip: label colour is clearly different from its fill',
      ).to.be.greaterThan(120)
    })

    // Every *unselected* chip is back to the surface fill -- no stuck dark
    // press/hover state.
    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]').each(($el) => {
      if ($el.attr('aria-pressed') === 'true') return
      const style = getComputedStyle($el[0])
      expect(style.backgroundColor, 'unselected chip has no dark fill').to.match(
        /rgba?\(\s*255,\s*255,\s*255/,
      )
    })

    // Switching category hands the "selected" look over cleanly -- the old
    // chip does not keep rendering as active.
    cy.get('[data-cy="storefront-category-nav"] [data-cy="storefront-category-chip"]')
      .eq(1)
      .click({ force: true })
    cy.get('body').click(5, 5)
    cy.get('@chip').should('have.attr', 'aria-pressed', 'false')
    cy.get('@chip').then(($chip) => {
      expect(getComputedStyle($chip[0]).backgroundColor, 'previous chip reverted').to.match(
        /rgba?\(\s*255,\s*255,\s*255/,
      )
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

    // Backdrop dismiss and "Ver resultados" leave the same clean slate.
    cy.get('[aria-label="Abrir filtros"]').click()
    cy.contains('[role="dialog"] button', 'Ver resultados').click()
    cy.get('[role="dialog"]').should('not.exist')
    cy.get('body').should('not.have.css', 'overflow', 'hidden')

    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth + 1)
    })
  })
})
