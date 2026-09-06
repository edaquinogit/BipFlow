/// <reference types="cypress" />
/**
 * BipFlow: Ciclo 8 closure -- real-browser visual/measurement audit.
 *
 * Not a regression gate (no business assertions beyond "the UI is in the
 * state the screenshot claims"). Its job is to produce real evidence
 * (screenshots + DOM measurements written to a JSON file) for the closure
 * report -- replacing the previous cycle's static/estimated claims with
 * numbers read from an actual rendered page in a real (headless Electron)
 * browser, against the real backend.
 */

const PRODUCT_NAME = 'Produto Demo E2E'

interface Measurements {
  [key: string]: unknown
}

const measurements: Measurements = {}

function recordMeasurement(key: string, value: unknown): void {
  measurements[key] = value
}

function addProductToCart(times = 1): void {
  for (let i = 0; i < times; i += 1) {
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 })
      .clear()
      .type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 })
      .find('[data-cy="add-to-cart-button"]')
      .click()
  }
}

// Adding the *same* product N times increments one cart line's quantity
// (useCart.addItem merges by product+variant) -- it does not create N
// lines. To answer "how many cart LINES are visible", the cart needs N
// *distinct* lines, so this clicks "Adicionar" on the first N different
// product cards in the catalog grid instead of searching for one product.
function addDistinctProductsToCart(count: number): void {
  cy.get('[data-cy="add-to-cart-button"]', { timeout: 15000 }).should('have.length.at.least', count)
  for (let i = 0; i < count; i += 1) {
    cy.get('[data-cy="add-to-cart-button"]').eq(i).click()
  }
}

describe('Ciclo 8 visual/measurement audit (real backend, real browser)', () => {
  afterEach(() => {
    cy.then(() => {
      cy.writeFile('cypress/reports/ciclo8-measurements.json', measurements)
    })
  })

  it('320x568 -- review step: counts real visible cart items with 3 items added', () => {
    cy.viewport(320, 568)
    cy.visit('/l/default/produtos')
    addDistinctProductsToCart(3)

    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart').should('be.visible')
    cy.screenshot('320x568-01-review-step', { capture: 'viewport' })

    cy.get('@cart').then(($cart) => {
      const cartRect = $cart[0].getBoundingClientRect()
      const header = $cart.find('header')[0].getBoundingClientRect()
      const scrollArea = $cart[0].querySelector('.overflow-y-auto') as HTMLElement
      const scrollRect = scrollArea.getBoundingClientRect()
      const footer = $cart.find('footer')[0].getBoundingClientRect()

      const articles = Array.from($cart.find('article')) as HTMLElement[]
      let fullyVisible = 0
      let partiallyVisible = 0
      const perItem: Array<{ index: number; top: number; bottom: number; state: string }> = []

      articles.forEach((article, index) => {
        const rect = article.getBoundingClientRect()
        const visibleTop = Math.max(rect.top, scrollRect.top)
        const visibleBottom = Math.min(rect.bottom, scrollRect.bottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)
        let state = 'not visible'
        if (visibleHeight >= rect.height - 1) {
          fullyVisible += 1
          state = 'fully visible'
        } else if (visibleHeight > 0) {
          partiallyVisible += 1
          state = 'partially visible'
        }
        perItem.push({ index, top: rect.top, bottom: rect.bottom, state })
      })

      const needsScroll = scrollArea.scrollHeight > scrollArea.clientHeight

      recordMeasurement('review_320x568', {
        drawerWidth: cartRect.width,
        drawerHeight: cartRect.height,
        headerHeightPx: header.height,
        scrollAreaHeightPx: scrollRect.height,
        footerHeightPx: footer.height,
        itemsAdded: 3,
        itemsFullyVisibleWithoutScrolling: fullyVisible,
        itemsPartiallyVisibleWithoutScrolling: partiallyVisible,
        needsScrollToSeeAllItems: needsScroll,
        perItem,
      })

      // Sanity assertions -- not a strict regression gate, just guards
      // against a totally broken measurement (e.g. 0-height drawer).
      expect(cartRect.height).to.be.greaterThan(400)
      expect(articles.length).to.eq(3)
    })
  })

  it('320x568 -- details step: empty, then blocked attempt with errors + focus, then filled', () => {
    cy.viewport(320, 568)
    cy.visit('/l/default/produtos')
    addProductToCart(1)
    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()

    // Empty details step: no errors yet.
    cy.get('@cart').find('input[autocomplete="name"]').should('not.have.attr', 'aria-invalid')
    cy.screenshot('320x568-02-details-empty', { capture: 'viewport' })

    // Measure the reduced footer in its normal (no-message) state.
    cy.get('@cart').find('footer').then(($footer) => {
      const rect = $footer[0].getBoundingClientRect()
      recordMeasurement('footer_320x568_normal_dom_measured_px', rect.height)
      cy.get('@cart').find('footer').should('contain', 'Total')
      cy.get('@cart').find('footer').should('not.contain', 'Produtos')
    })

    // Blocked attempt.
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').should('be.enabled').click()
    cy.get('@cart').contains('Revise os campos destacados.').should('be.visible')
    cy.get('@cart').contains('Informe seu nome.').should('be.visible')
    cy.get('@cart').find('input[autocomplete="name"]').should('be.focused')
    cy.get('@cart').find('input[autocomplete="name"]').should('have.attr', 'aria-invalid', 'true')
    cy.get('@cart').find('input[autocomplete="name"]')
      .invoke('attr', 'aria-describedby')
      .should('eq', 'checkout-field-full-name-error')
    cy.get('#checkout-field-full-name-error').should('exist').and('be.visible')
    cy.screenshot('320x568-03-details-errors-focused-field', { capture: 'viewport' })

    // Structural note in the footer while a message is present -- measure
    // that height too (the *variant* the previous cycle never measured).
    cy.get('@cart').find('footer').then(($footer) => {
      recordMeasurement('footer_320x568_with_structural_or_review_note_dom_measured_px', $footer[0].getBoundingClientRect().height)
    })

    // The focused element must not sit under the (non-sticky) footer/header --
    // verified by bounding-box containment against the scroll viewport.
    cy.get('@cart').then(($cart) => {
      const scrollArea = $cart[0].querySelector('.overflow-y-auto') as HTMLElement
      const scrollRect = scrollArea.getBoundingClientRect()
      // Cypress spec code runs in the *runner's* page -- the bare global
      // `document` is not the app-under-test's document, so its
      // `activeElement` is meaningless here. `ownerDocument` on any node
      // already inside the AUT (the cart) gives the real one.
      const focused = $cart[0].ownerDocument.activeElement as HTMLElement
      const focusedRect = focused.getBoundingClientRect()
      const coveredByHeaderOrFooter = focusedRect.top < scrollRect.top || focusedRect.bottom > scrollRect.bottom
      recordMeasurement('focused_field_covered_by_header_or_footer', coveredByHeaderOrFooter)
      expect(coveredByHeaderOrFooter, 'focused field must be within the scrollable area, not under header/footer').to.be.false
    })

    // Fill everything, pick a region -> summary updates reactively, errors clear.
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Auditoria')
    cy.get('@cart').find('input[autocomplete="tel"]').type(`1199${Date.now().toString().slice(-8)}`)
    cy.get('@cart').contains('label', 'Regiao de entrega').find('select').then(($select) => {
      const centro = [...$select[0].options].find((o) => /Centro/.test(o.textContent ?? ''))
      cy.wrap($select).select((centro as HTMLOptionElement).value)
    })
    cy.get('@cart').find('input[autocomplete="street-address"]').type('Rua Auditoria, 1')
    cy.get('@cart').find('input[autocomplete="address-level3"]').type('Centro')
    cy.get('@cart').find('input[autocomplete="address-level2"]').type('Salvador')

    cy.get('@cart').contains('Informe seu nome.').should('not.exist')
    cy.get('@cart').find('[data-cy="checkout-summary"]').should('contain', 'Frete').and('contain', '5,00')
    cy.screenshot('320x568-04-body-summary-region-selected', { capture: 'viewport' })
  })

  it('320x568 -- toast dedup: three rapid adds of the same product show one toast', () => {
    cy.viewport(320, 568)
    cy.visit('/l/default/produtos')
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(PRODUCT_NAME)
    cy.contains('article', PRODUCT_NAME, { timeout: 15000 }).as('productCard')

    cy.get('@productCard').find('[data-cy="add-to-cart-button"]').click()
    cy.get('@productCard').find('[data-cy="add-to-cart-button"]').click()
    cy.get('@productCard').find('[data-cy="add-to-cart-button"]').click()

    cy.get('[data-cy="toast-success"]').should('have.length', 1)
    cy.screenshot('320x568-05-toast-deduped-single', { capture: 'viewport' })
    recordMeasurement('toast_dedup_same_product_visible_count', 1)
  })

  it('320x568 -- toast dedup: three different products added quickly still show one toast', () => {
    cy.viewport(320, 568)
    cy.visit('/l/default/produtos')

    cy.get('[data-cy="add-to-cart-button"]', { timeout: 15000 }).should('have.length.at.least', 3)
    cy.get('[data-cy="add-to-cart-button"]').eq(0).click()
    cy.get('[data-cy="add-to-cart-button"]').eq(1).click()
    cy.get('[data-cy="add-to-cart-button"]').eq(2).click()

    cy.get('[data-cy="toast-success"]').should('have.length', 1)
    cy.screenshot('320x568-05b-toast-deduped-different-products', { capture: 'viewport' })
    recordMeasurement('toast_dedup_different_products_visible_count', 1)
  })

  it('390x844 -- a checkout error toast while the cart is open does not cover the title, CTA or Total', () => {
    // Reuses the exact real-failure path from the retry test above (same
    // 503-then-succeed intercept) so the toast-vs-overlay positioning is
    // checked against a toast that actually fired from the real flow, not a
    // synthetic one.
    cy.viewport(390, 844)
    cy.visit('/l/default/produtos')
    addProductToCart(1)
    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Overlap')
    cy.get('@cart').find('input[autocomplete="tel"]').type(`1199${Date.now().toString().slice(-8)}`)
    cy.get('@cart').contains('label', 'Entrega').find('select').select('pickup')
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/', { statusCode: 503, body: {} }).as('checkoutFail')
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').click()
    cy.wait('@checkoutFail')
    cy.get('[data-cy="toast-error"]').should('be.visible')

    cy.get('[data-cy="toast-error"]').then(($toast) => {
      const toastRect = $toast[0].getBoundingClientRect()
      cy.get('@cart').find('h2, h3').first().then(($title) => {
        const titleRect = $title[0].getBoundingClientRect()
        const overlapsTitle = !(toastRect.bottom < titleRect.top || toastRect.top > titleRect.bottom)
        recordMeasurement('toast_overlaps_drawer_title', overlapsTitle)
        expect(overlapsTitle, 'toast must not cover the drawer title').to.be.false
      })
      cy.get('@cart').find('[aria-label="Fechar carrinho"]').then(($close) => {
        const closeRect = $close[0].getBoundingClientRect()
        const overlapsClose = !(
          toastRect.right < closeRect.left
          || toastRect.left > closeRect.right
          || toastRect.bottom < closeRect.top
          || toastRect.top > closeRect.bottom
        )
        recordMeasurement('toast_overlaps_close_button', overlapsClose)
        expect(overlapsClose, 'toast must not cover the close button').to.be.false
      })
      cy.get('@cart').find('footer').then(($footer) => {
        const footerRect = $footer[0].getBoundingClientRect()
        const overlapsFooter = toastRect.bottom > footerRect.top
        recordMeasurement('toast_overlaps_footer_cta', overlapsFooter)
        expect(overlapsFooter, 'toast must not cover the Total/CTA footer').to.be.false
      })
    })
    cy.screenshot('390x844-05d-error-toast-does-not-cover-drawer-chrome', { capture: 'viewport' })
  })

  it('390x844 -- retry after a checkout failure keeps data, step and shows the error toast', () => {
    cy.viewport(390, 844)
    cy.visit('/l/default/produtos')
    addProductToCart(1)
    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').as('cart')
    cy.get('@cart').find('[data-cy="checkout-continue-button"]').click()
    cy.get('@cart').find('input[autocomplete="name"]').type('Cliente Retry Visual')
    cy.get('@cart').find('input[autocomplete="tel"]').type(`1199${Date.now().toString().slice(-8)}`)
    cy.get('@cart').contains('label', 'Entrega').find('select').select('pickup')

    // Real backend for everything except this one attempt -- force it to
    // fail once, exactly like a real transient server error would.
    let attempt = 0
    cy.intercept('POST', '**/api/v1/checkout/whatsapp/', (req) => {
      attempt += 1
      if (attempt === 1) {
        req.reply({ statusCode: 503, body: {} })
      } else {
        req.continue()
      }
    }).as('checkout')
    cy.window().then((win) => cy.stub(win, 'open').returns({}).as('windowOpen'))

    cy.get('@cart').find('[data-cy="checkout-submit-button"]').click()
    cy.wait('@checkout')
    cy.get('[data-cy="toast-error"]').should('be.visible')
    cy.screenshot('390x844-07-retry-after-error-toast', { capture: 'viewport' })

    cy.get('@cart').find('input[autocomplete="name"]').should('have.value', 'Cliente Retry Visual')
    cy.get('@cart').find('[data-cy="checkout-submit-button"]').should('be.enabled').click()
    cy.wait('@checkout')
    cy.get('@windowOpen').should('have.been.calledOnce')
  })

  it('desktop 1440x900 -- checkout drawer over the full storefront', () => {
    cy.viewport(1440, 900)
    cy.visit('/l/default/produtos')
    addProductToCart(1)
    cy.get('[data-cy="open-cart-button"]').click()
    cy.get('[aria-label="Carrinho de pedido"]').find('[data-cy="checkout-continue-button"]').click()
    cy.screenshot('1440x900-06-desktop-details-step', { capture: 'viewport' })
  })

  ;([
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
  ] as const).forEach(([width, height]) => {
    it(`${width}x${height} -- review + details render without horizontal overflow`, () => {
      cy.viewport(width, height)
      cy.visit('/l/default/produtos')
      addProductToCart(1)
      cy.get('[data-cy="open-cart-button"]').click()
      cy.screenshot(`${width}x${height}-review`, { capture: 'viewport' })
      cy.get('[aria-label="Carrinho de pedido"]').find('[data-cy="checkout-continue-button"]').click()
      cy.screenshot(`${width}x${height}-details`, { capture: 'viewport' })

      cy.document().then((doc) => {
        const overflowing = doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1
        recordMeasurement(`overflow_${width}x${height}`, overflowing)
        expect(overflowing, `no horizontal overflow at ${width}x${height}`).to.be.false
      })
    })
  })
})
