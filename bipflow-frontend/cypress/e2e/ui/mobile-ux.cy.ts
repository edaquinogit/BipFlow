/// <reference types="cypress" />
describe('mobile UX regressions', () => {
  it('keeps the viewport mobile-safe and renders the real storefront', () => {
    // Explicit CSS pixel dimensions (iPhone 14, 390x844) instead of a named
    // preset -- Cypress's built-in preset list doesn't track new device
    // names (this Cypress version has no "iphone-14"), so a name is one
    // Cypress upgrade away from breaking again; raw dimensions never go stale.
    cy.viewport(390, 844)

    // '/produtos' (PublicRoutes.Products) is the public, unauthenticated
    // storefront root -- '/dashboard' requires auth and this test never
    // logs in, so it would always land on the login screen instead.
    cy.visit('/produtos')

    // Ciclo 1 (Fundação Visual da Vitrine): pinch/double-tap zoom must NOT be
    // blocked (WCAG 1.4.4 / 1.4.10). The viewport is device-width + safe-area
    // only -- no maximum-scale, no user-scalable=no.
    cy.get('meta[name="viewport"]')
      .should('have.attr', 'content')
      .and('contain', 'width=device-width')
      .and('contain', 'viewport-fit=cover')
      .and('not.contain', 'maximum-scale')
      .and('not.contain', 'user-scalable')

    // This test used to assert IntroSplash.vue's "bem-vindo" welcome dialog
    // rendered here -- removed intentionally in adbe25d ("Removes the idle
    // storefront intro splash and updates dashboard, PDV, auth and customer
    // storefront accents to the neutral theme"), not a regression. In its
    // place: confirm the storefront itself actually rendered real content on
    // a mobile viewport, not a blank/crashed page -- the thing this spec is
    // actually meant to guard.
    cy.get('[data-cy="open-cart-button"]', { timeout: 15000 }).should('be.visible')
    cy.get('input[type="search"]').should('be.visible')

    cy.get('input').first().should(($input) => {
      const fontSize = window.getComputedStyle($input[0]).fontSize
      expect(fontSize).to.equal('16px')
    })
  })
})
