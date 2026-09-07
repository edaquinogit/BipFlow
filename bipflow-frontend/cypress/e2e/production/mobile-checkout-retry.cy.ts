/// <reference types="cypress" />

type CheckoutRequestBody = {
  idempotency_key?: string
  items: Array<{ product_id: number; variant_id?: number | null; quantity: number }>
  customer: {
    delivery_method: 'delivery' | 'pickup'
    payment_method: 'pix' | 'card' | 'cash'
    delivery_region_id: number | null
    full_name: string
    phone: string
    address: string
    neighborhood: string
    city: string
  }
}

const store = {
  id: 1,
  name: 'Loja Default',
  display_name: 'Loja Default',
  slug: 'default',
  logo_url: '',
  tagline: 'Vitrine operacional',
  whatsapp_phone: '5571999999999',
  theme: {
    primary: '#05050A',
    accent: '#111827',
    background: '#FAFAFA',
    surface: '#FFFFFF',
    text: '#05050A',
    muted: '#6B7280',
  },
  is_active: true,
  status: 'active',
  receipt_exchange_policy: '',
  receipt_paper_format: '80mm',
}

const category = {
  id: 10,
  name: 'Prontos',
  slug: 'prontos',
  description: '',
  parent: null,
  parent_name: null,
  product_count: 1,
  children_count: 0,
  created_at: '2026-08-28T00:00:00Z',
}

const product = {
  id: 101,
  name: 'Combo Mobile',
  slug: 'combo-mobile',
  public_code: 'BPF101',
  sku: 'MOB-101',
  description: 'Produto pronto para checkout mobile',
  price: '42.50',
  size: null,
  category: {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parent: null,
    parent_name: null,
  },
  image: null,
  images: [],
  variants: [],
  stock_quantity: 5,
  low_stock_threshold: null,
  is_available: true,
  created_at: '2026-08-28T00:00:00Z',
}

const publicAppearance = {
  store_name: store.name,
  store_slug: store.slug,
  logo_url: '',
  tagline: store.tagline,
  theme: store.theme,
  secondary_color: '#111827',
  favicon_url: '',
  hero_enabled: false,
  hero_image_desktop: '',
  hero_image_mobile: '',
  hero_alt_text: '',
  hero_title: '',
  hero_subtitle: '',
  hero_cta_text: '',
  hero_destination_type: 'none',
  hero_destination_value: '',
  hero_cta_url: '',
  card_style: 'clean',
  radius_style: 'minimal',
  density: 'comfortable',
  font_preset: 'modern',
  motion_enabled: false,
  motion_intensity: 'subtle',
  decoration_enabled: false,
  decoration_style: 'none',
}

function stubStorefrontApis(checkoutRequests: CheckoutRequestBody[]): void {
  cy.intercept('GET', '**/api/v1/store/current/', store)
  cy.intercept('GET', '**/api/v1/categories/**', [category])
  cy.intercept('GET', '**/api/v1/products/**', {
    count: 1,
    next: null,
    previous: null,
    page_size: 12,
    total_pages: 1,
    results: [product],
  })
  cy.intercept('GET', '**/api/v1/delivery-regions/active/', [
    {
      id: 7,
      name: 'Centro',
      city: 'Salvador',
      neighborhoods: '',
      delivery_fee: '12.00',
      is_active: true,
      created_at: '2026-08-28T00:00:00Z',
      updated_at: '2026-08-28T00:00:00Z',
    },
  ])
  cy.intercept('GET', '**/api/v1/store-settings/public/', {
    whatsapp_phone_digits: '5571999999999',
    is_whatsapp_configured: true,
  })
  cy.intercept('GET', '**/api/v1/public/stores/default/appearance/', publicAppearance)
  cy.intercept('GET', '**/api/v1/public/stores/default/banners/', [])
  cy.intercept('POST', '**/api/v1/checkout/whatsapp/', (req) => {
    const body = req.body as CheckoutRequestBody
    const firstItem = body.items[0] ?? {
      product_id: product.id,
      variant_id: null,
      quantity: 1,
    }
    checkoutRequests.push(body)

    // First attempt: a deterministic transient backend failure. Deliberately
    // NOT { forceNetworkError: true } -- in Electron/Chromium a connection
    // destroyed with zero bytes received is transparently retried by the
    // browser's net stack, so the stub answers that retry with the success
    // branch below and the order completes before the test runs its own
    // explicit retry (the drawer unmounts on the premature success, so
    // [data-cy="checkout-submit-button"] is "never found"). A 503 exercises
    // the identical frontend path: api.ts's >= 500 branch falls through to
    // Promise.reject, handleSubmitOrder's catch shows the error toast,
    // `finally` clears isSubmittingOrder, and the idempotency key is kept
    // (clearCheckoutIdempotencyKey only runs after a resolved POST).
    if (checkoutRequests.length === 1) {
      req.reply({ statusCode: 503, body: {} })
      return
    }

    req.reply({
      statusCode: 200,
      body: {
        order_reference: 'BPF-MOBILE-1',
        items: [
          {
            product_id: firstItem.product_id,
            variant_id: null,
            product_name: product.name,
            variant_name: '',
            variant_color_hex: '',
            variant_image_url: '',
            sku: product.sku,
            quantity: firstItem.quantity,
            unit_price: product.price,
            line_total: product.price,
          },
        ],
        customer: {
          ...body.customer,
          delivery_region_name: 'Centro',
          email: '',
          notes: '',
        },
        subtotal: product.price,
        delivery_fee: '12.00',
        total: '54.50',
        message: 'Pedido BipFlow',
        whatsapp_url: 'https://wa.me/5571999999999?text=Pedido%20BipFlow',
      },
    })
  }).as('checkout')
}

function stubWindowOpenBeforeLoad(): void {
  const openStub = cy.stub().returns({})
  cy.wrap(openStub).as('windowOpen')

  cy.on('window:before:load', (win) => {
    win.open = openStub
  })
}

describe('production mobile checkout retry', () => {
  it('keeps the same idempotency key after a transient checkout failure', () => {
    const checkoutRequests: CheckoutRequestBody[] = []
    stubStorefrontApis(checkoutRequests)
    stubWindowOpenBeforeLoad()

    cy.viewport(390, 844)
    cy.visit('/l/default/produtos')

    cy.get('[data-cy="add-to-cart-button"]', { timeout: 15000 })
      .should('be.enabled')
      .click()
    cy.get('[data-cy="open-cart-button"]').click()
    // Step 1 -> Step 2 (checkout is a two-step drawer since Cycle 7).
    cy.get('[aria-label="Carrinho de pedido"] [data-cy="checkout-continue-button"]').click()

    cy.get('input[autocomplete="name"]').type('Cliente Mobile')
    cy.get('input[autocomplete="tel"]').type('11999990000')
    cy.get('input[autocomplete="street-address"]').type('Rua Mobile, 123')
    cy.get('input[autocomplete="address-level3"]').type('Centro')
    cy.get('input[autocomplete="address-level2"]').type('Salvador')

    cy.get('[data-cy="checkout-submit-button"]').should('be.enabled').click()
    cy.wait('@checkout')

    // First attempt failed: the cart drawer stays open in a recoverable
    // state -- error toast shown, loading finished, submit usable again.
    cy.get('[data-cy="toast-error"]').should('be.visible')
    cy.get('[data-cy="checkout-submit-button"]', { timeout: 10000 })
      .should('be.enabled')
    cy.get('[data-cy="checkout-submit-button"]').click()
    cy.wait('@checkout')

    cy.wrap(checkoutRequests).should((requests) => {
      expect(requests).to.have.length(2)
      expect(requests[0].idempotency_key).to.be.a('string').and.not.be.empty
      expect(requests[1].idempotency_key).to.eq(requests[0].idempotency_key)
      expect(requests[1].items).to.deep.eq(requests[0].items)
      expect(requests[1].customer.phone).to.eq('11999990000')
    })
    cy.get('@windowOpen').should('have.been.calledOnce')
  })
})
