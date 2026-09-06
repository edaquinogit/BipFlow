/// <reference types="cypress" />
/**
 * Ciclo 9 (complementary fix): a variant image uploaded in the dashboard kept
 * showing as a solid color on the storefront instead of the real photo. The
 * root cause was purely frontend (ProductDetailView/ProductCard/CartDrawer
 * never checked `variant.image` before painting `color_hex`) -- the backend
 * upload -> persistence -> public serializer path was already correct (see
 * ProductVariantImageAPITest in bipdelivery/tests/test_api_health.py).
 *
 * This is the one full, real-backend journey the fix needs: upload two
 * different variant images through the real dashboard form, confirm they
 * persist across an admin reload, then confirm the storefront shows the
 * right *photo* (not a color) for each variant, that switching is instant,
 * and that it survives a storefront reload. A third, image-less variant
 * proves the color fallback still works when there's genuinely no photo.
 */

type AuthTokens = { access: string }
type CategoryResponse = { id: number; name: string }

const TEST_IMAGE_PATH = 'cypress/fixtures/test-product-image.png'

const getApiBaseUrl = () =>
  String(Cypress.env('apiBaseUrl') || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

describe('Variant images: dashboard upload, persistence, storefront display (real backend)', () => {
  const productName = `Variante Imagem E2E ${Date.now()}`

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
              body: { name: `E2E Variant Image Category ${Date.now()}` },
            })
            .then((createResponse) => {
              Cypress.env('e2eCategoryId', createResponse.body.id)
            })
        })
    })
  })

  it('creates a product with three variants (two with photos, one color-only), and the dashboard admin persists the previews', () => {
    cy.intercept('GET', '**/api/v1/products/**').as('getProducts')
    cy.intercept('GET', '**/api/v1/categories/**').as('getCategories')
    cy.visitWithAuth('/dashboard/produtos')
    cy.wait('@getProducts', { timeout: 10000 })
    cy.wait('@getCategories', { timeout: 10000 })

    cy.get('[data-cy="btn-add-product"]', { timeout: 5000 }).should('be.visible').click()
    cy.get('[data-cy="product-form-panel"]', { timeout: 3000 }).should('be.visible')

    cy.get('input[name="name"]').should('be.visible').type(productName)
    cy.get('input[name="price"]').scrollIntoView().type('79.90')
    cy.get('input[name="stock_quantity"]').scrollIntoView().type('12')

    cy.get('[data-cy="select-category"]').scrollIntoView().should('be.visible').click()
    cy.get(`[data-cy="category-option-${Cypress.env('e2eCategoryId')}"]`)
      .scrollIntoView()
      .should('be.visible')
      .click()

    // --- Variant 1: "Vermelho E2E", with its own photo -------------------
    cy.contains('button', 'Adicionar primeira cor').scrollIntoView().click()
    cy.get('input[placeholder="Preto, azul..."]').last().type('Vermelho E2E')
    cy.get('[aria-label="Quantidade em estoque da variante Vermelho E2E"]').type('5')
    cy.get('[aria-label="Enviar imagem da variante Vermelho E2E"]')
      .scrollIntoView()
      .should('exist')
      .selectFile(TEST_IMAGE_PATH, { force: true })
    cy.get('img[alt="Imagem da variante Vermelho E2E"]', { timeout: 5000 })
      .should('exist')
      .should('have.attr', 'src')
      .and('match', /^blob:/)

    // --- Variant 2: "Azul E2E", with a different photo --------------------
    cy.get('[aria-label="Adicionar variante de cor"]').click()
    cy.get('input[placeholder="Preto, azul..."]').last().type('Azul E2E')
    cy.get('[aria-label="Quantidade em estoque da variante Azul E2E"]').type('5')
    cy.get('[aria-label="Enviar imagem da variante Azul E2E"]')
      .scrollIntoView()
      .should('exist')
      .selectFile(TEST_IMAGE_PATH, { force: true })
    cy.get('img[alt="Imagem da variante Azul E2E"]', { timeout: 5000 })
      .should('exist')
      .should('have.attr', 'src')
      .and('match', /^blob:/)

    // --- Variant 3: "Verde E2E", no photo at all (color-only fallback) ----
    cy.get('[aria-label="Adicionar variante de cor"]').click()
    cy.get('input[placeholder="Preto, azul..."]').last().type('Verde E2E')
    cy.get('[aria-label="Quantidade em estoque da variante Verde E2E"]').type('5')
    cy.get('[aria-label="Selecionar cor da variante Verde E2E"]')
      .scrollIntoView()
      .invoke('val', '#00aa00')
      .trigger('input')

    cy.get('[data-cy="btn-submit-product"]').scrollIntoView().should('not.be.disabled').click()
    cy.get('[data-cy="toast-success"]', { timeout: 10000 }).should('be.visible')
    cy.get('[data-cy="product-form-panel"]', { timeout: 5000 }).should('not.exist')

    // --- Reload the admin: previews must still be there, from real URLs --
    cy.contains('[data-cy="product-table-row"]', productName, { timeout: 10000 })
      .find('[title="Editar produto"]')
      .click({ force: true })
    cy.get('[data-cy="product-form-panel"]', { timeout: 5000 }).should('be.visible')

    cy.get('img[alt="Imagem da variante Vermelho E2E"]')
      .should('have.attr', 'src')
      .and('match', /^https?:\/\//)
    cy.get('img[alt="Imagem da variante Azul E2E"]')
      .should('have.attr', 'src')
      .and('match', /^https?:\/\//)
    // Two distinct uploads of the same source file still get distinct
    // storage paths (the storage backend suffixes the second on collision).
    cy.get('img[alt="Imagem da variante Vermelho E2E"]').then(($red) => {
      cy.get('img[alt="Imagem da variante Azul E2E"]').then(($blue) => {
        expect($red.attr('src')).not.to.eq($blue.attr('src'))
      })
    })
    // Verde E2E never got a photo -- no preview <img>, ever.
    cy.get('img[alt="Imagem da variante Verde E2E"]').should('not.exist')

    cy.get('[data-cy="btn-close-form"]').click()
    cy.get('[data-cy="product-form-panel"]').should('not.exist')
  })

  it('shows the real variant photo on the storefront, swaps it on selection, and survives a reload', () => {
    cy.visit('/l/default/produtos')
    cy.get('input[aria-label="Buscar produtos por nome"]', { timeout: 15000 }).type(productName)
    cy.contains('article', productName, { timeout: 15000 }).should('be.visible').click()
    cy.location('pathname', { timeout: 10000 }).should('match', /\/l\/default\/produtos\/.+/)

    const heroImage = () => cy.get(`img[alt="Imagem do produto ${productName}"]`, { timeout: 10000 })

    // "Vermelho E2E" was created first (position 0) and is the auto-selected
    // variant on first load, now that every variant has stock; capture its
    // URL as a baseline via a Cypress alias (a plain closure variable is not
    // reliable here since intervening commands run asynchronously).
    heroImage().invoke('attr', 'src').as('vermelhoSrc')
    cy.get('@vermelhoSrc').should('match', /^https?:\/\//)
    cy.get('[aria-label="Selecionar cor Vermelho E2E"] img').should('exist')

    cy.get('[aria-label="Selecionar cor Azul E2E"]').click()
    cy.get('@vermelhoSrc').then((vermelhoSrc) => {
      heroImage().should(($img) => {
        expect($img.attr('src')).to.not.eq(vermelhoSrc)
      })
    })
    heroImage().invoke('attr', 'src').as('azulSrc')
    cy.get('@azulSrc').should('match', /^https?:\/\//)
    cy.get('[aria-label="Selecionar cor Azul E2E"] img').should('exist')

    cy.get('[aria-label="Selecionar cor Vermelho E2E"]').click()
    cy.get('@vermelhoSrc').then((vermelhoSrc) => {
      heroImage().should('have.attr', 'src', vermelhoSrc)
    })

    // The color-only variant must fall back to a color swatch on its own
    // chip, and must not paint over -- or be painted over by -- a photo.
    cy.get('[aria-label="Selecionar cor Verde E2E"] img').should('not.exist')
    cy.get('[aria-label="Selecionar cor Verde E2E"] span[style]')
      .should('have.attr', 'style')
      .and('contain', 'background-color')

    // Add "Vermelho E2E" (currently selected) to the cart, then reload the
    // page entirely -- the API-served image must still be correct after.
    cy.contains('button', /Adicionar/).click()
    cy.reload()
    cy.location('pathname', { timeout: 10000 }).should('match', /\/l\/default\/produtos\/.+/)
    cy.get('[aria-label="Selecionar cor Azul E2E"]', { timeout: 10000 }).click()
    cy.get('@azulSrc').then((azulSrc) => {
      heroImage().should('have.attr', 'src', azulSrc)
    })
    cy.get('[aria-label="Selecionar cor Vermelho E2E"]').click()
    cy.get('@vermelhoSrc').then((vermelhoSrc) => {
      heroImage().should('have.attr', 'src', vermelhoSrc)
    })

    cy.get('[data-cy="open-cart-button"]', { timeout: 10000 }).click()
    cy.get('[aria-label="Carrinho de pedido"]').should('contain', 'Vermelho E2E')
  })
})
