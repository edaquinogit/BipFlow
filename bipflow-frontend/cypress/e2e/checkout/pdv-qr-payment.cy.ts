/// <reference types="cypress" />
/**
 * BipFlow PDV: QR / código, pagamento presencial e idempotência --
 * end-to-end contra o backend REAL na loja semeada `default`
 * (`manage.py seed_e2e_demo_data`). Ver
 * docs/architecture/pdv-qr-payment-evolution.md.
 *
 * A câmera real (getUserMedia + qr-scanner) não roda de forma determinística
 * em CI, então o "decode" é exercido pelo caminho equivalente e
 * determinístico: colar no campo de scan exatamente o texto que a câmera
 * produziria -- a URL de deep-link do produto -- que passa pelo mesmo
 * `parseScanPayload()` + `getByCode` + carrinho. Cobre:
 *
 *  1. venda por busca manual (fallback sem câmera);
 *  2. "decode" determinístico de uma URL de deep-link -> carrinho;
 *  3. permissão de câmera negada -> erro claro + fallback utilizável;
 *  4. o mesmo código lido duas vezes -> uma linha (agregação);
 *  5. dois códigos diferentes -> duas linhas;
 *  6. pagamento em dinheiro: troco e bloqueio abaixo do total;
 *  7. pagamento pix: exige confirmação manual do caixa;
 *  8. double-submit -> uma única venda (idempotência);
 *  9. falha de rede + retry -> uma única venda (mesma chave);
 * 10. finalização baixa estoque e mostra o resumo.
 *
 * O estoque da loja `default` é compartilhado entre specs, então cada venda
 * usa quantidade 1 e o teste não assume um valor absoluto de estoque, só o
 * delta.
 */

const apiBaseUrl = () =>
  (Cypress.env('apiBaseUrl') || 'http://localhost:8000/api').replace(/\/$/, '')

function authHeaders() {
  const tokens = Cypress.env('authTokens') as { access: string } | undefined
  if (!tokens?.access) {
    throw new Error('Call cy.loginViaApi() first')
  }
  return { Authorization: `Bearer ${tokens.access}` }
}

interface SeedProduct {
  publicCode: string
  name: string
  price: string
  deepLink: string
}

/** Two variant-less, in-stock products from the seed, with their codes. */
function loadTwoProducts(): Cypress.Chainable<[SeedProduct, SeedProduct]> {
  return cy
    .request({ url: `${apiBaseUrl()}/v1/products/?page_size=50`, headers: authHeaders() })
    .then((response) => {
      const results = (response.body.results ?? response.body) as Array<Record<string, unknown>>
      const usable = results
        .filter((p) => (p.variants as unknown[] | undefined)?.length !== undefined
          ? (p.variants as unknown[]).length === 0
          : true)
        .filter((p) => Number(p.stock_quantity) > 3 && p.is_available && p.public_code)
        .slice(0, 2)
        .map((p) => ({
          publicCode: String(p.public_code),
          name: String(p.name),
          price: String(p.price),
          deepLink: `https://bipflow.pages.dev/l/default/p/${String(p.public_code)}`,
        }))
      expect(usable.length, 'two usable seed products').to.eq(2)
      return usable as [SeedProduct, SeedProduct]
    })
}

function pdvSalesCount(): Cypress.Chainable<number> {
  return cy
    .request({
      url: `${apiBaseUrl()}/v1/sales-orders/?channel=loja_fisica&page_size=1`,
      headers: authHeaders(),
    })
    .then((r) => Number(r.body.count))
}

function stockFor(code: string): Cypress.Chainable<number> {
  return cy
    .request({ url: `${apiBaseUrl()}/v1/products/by-code/${code}/`, headers: authHeaders() })
    .then((r) => Number(r.body.stock_quantity))
}

describe('PDV -- QR/código, pagamento presencial e idempotência (backend real)', () => {
  beforeEach(() => {
    cy.loginViaApi()
    cy.visitWithAuth('/dashboard/pdv')
    cy.get('[data-cy="pdv-scan-input"]', { timeout: 15000 }).should('be.visible')
  })

  it('1. venda por busca manual pelo nome do produto', () => {
    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-toggle-search"]').click()
      cy.get('[data-cy="pdv-search-input"]').type(product.name.slice(0, 6))
      cy.get('[data-cy="pdv-search-submit"]').click()
      cy.get('[data-cy="pdv-search-result"]').first().click()
      cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
      cy.get('[data-cy="pdv-cart-table"]').should('contain', product.name)
    })
  })

  it('2. "decode" de uma URL de deep-link cai no carrinho como o código puro', () => {
    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-scan-input"]').type(`${product.deepLink}{enter}`)
      cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
      cy.get('[data-cy="pdv-cart-table"]').should('contain', product.name)
    })
  })

  it('3. permissao de camera negada mostra mensagem acionavel e a busca continua utilizavel', () => {
    // Re-visit with getUserMedia denied (the headless runner otherwise
    // hands the scanner a fake stream). The auth cookie from beforeEach's
    // loginViaApi persists across this in-test navigation.
    cy.visit('/dashboard/pdv', {
      onBeforeLoad(win) {
        const md = win.navigator.mediaDevices
        if (md) {
          cy.stub(md, 'getUserMedia').rejects(
            new DOMException('denied', 'NotAllowedError'),
          )
        }
      },
    })
    cy.get('[data-cy="pdv-scan-input"]', { timeout: 15000 }).should('be.visible')

    cy.get('[data-cy="pdv-open-camera-scanner"]').click()
    cy.get('[data-cy="pdv-camera-error"]', { timeout: 10000 })
      .invoke('text')
      .should('match', /c[aâ]mera|permiss|navegador|conex[aã]o/i)
    cy.get('[data-cy="pdv-camera-close"]').click()

    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-toggle-search"]').click()
      cy.get('[data-cy="pdv-search-input"]').type(product.name.slice(0, 6))
      cy.get('[data-cy="pdv-search-panel"] form').submit()
      cy.get('[data-cy="pdv-search-result"]').first().click()
      cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
    })
  })

  it('4. o mesmo codigo lido duas vezes vira uma linha com quantidade 2', () => {
    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
      cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
      cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
      cy.get('[data-cy="pdv-cart-quantity"]').should('have.text', '2')
    })
  })

  it('5. dois codigos diferentes viram duas linhas', () => {
    loadTwoProducts().then(([a, b]) => {
      cy.get('[data-cy="pdv-scan-input"]').type(`${a.publicCode}{enter}`)
      cy.get('[data-cy="pdv-scan-input"]').type(`${b.publicCode}{enter}`)
      cy.get('[data-cy="pdv-cart-row"]').should('have.length', 2)
    })
  })

  it('6. dinheiro: bloqueia abaixo do total e calcula o troco', () => {
    // Tall viewport so the whole sidebar (a sticky column) fits without
    // scrolling -- this test is about the cash maths + finalize gate, not
    // the sticky layout (which has its own regression test).
    cy.viewport(1280, 1600)
    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
      cy.get('[data-cy="pdv-payment-method"]').select('cash')
      cy.get('[data-cy="pdv-cash-panel"]').should('be.visible')
      cy.get('[data-cy="pdv-finalize-sale"]').should('be.disabled')

      cy.get('[data-cy="pdv-cash-received"]').type('1,00')
      cy.get('[data-cy="pdv-cash-insufficient"]').should('be.visible')
      cy.get('[data-cy="pdv-finalize-sale"]').should('be.disabled')

      cy.get('[data-cy="pdv-cash-received"]').clear().type('500,00')
      cy.get('[data-cy="pdv-cash-change"]').should('be.visible').and('contain', 'R$')
      cy.get('[data-cy="pdv-finalize-sale"]').should('not.be.disabled')
    })
  })

  it('7. pix exige a confirmacao manual do recebimento antes de finalizar', () => {
    loadTwoProducts().then(([product]) => {
      cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
      cy.get('[data-cy="pdv-payment-method"]').select('pix')
      cy.get('[data-cy="pdv-finalize-sale"]').should('be.disabled')
      cy.get('[data-cy="pdv-payment-confirm-checkbox"]').check()
      cy.get('[data-cy="pdv-finalize-sale"]').should('not.be.disabled')
    })
  })

  it('8. double-submit registra uma unica venda', () => {
    loadTwoProducts().then(([product]) => {
      pdvSalesCount().then((before) => {
        cy.intercept('POST', '**/api/v1/pdv/sales/', (req) => {
          req.on('response', (res) => res.setDelay(800))
        }).as('sale')

        cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
        cy.get('[data-cy="pdv-payment-confirm-checkbox"]').check()
        cy.get('[data-cy="pdv-finalize-sale"]').click()
        cy.get('[data-cy="pdv-finalize-sale"]').click({ force: true })

        cy.wait('@sale')
        cy.get('[data-cy="pdv-receipt-order-reference"]', { timeout: 10000 }).should('be.visible')
        pdvSalesCount().then((after) => expect(after - before).to.eq(1))
      })
    })
  })

  it('9. falha transitoria seguida de retry nao duplica a venda', () => {
    loadTwoProducts().then(([product]) => {
      pdvSalesCount().then((before) => {
        let attempt = 0
        // Attempt 1 fails with a 503 before reaching the backend; attempt 2
        // passes through. A `forceNetworkError`/`destroy` is avoided on
        // purpose -- Chromium silently auto-retries those.
        cy.intercept('POST', '**/api/v1/pdv/sales/', (req) => {
          attempt += 1
          if (attempt === 1) {
            req.reply({ statusCode: 503, body: { detail: 'indisponivel' }, delay: 50 })
          }
        }).as('sale')

        cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
        cy.get('[data-cy="pdv-payment-confirm-checkbox"]').check()
        cy.get('[data-cy="pdv-finalize-sale"]').click()
        // Carrinho preservado apos a falha; botao reabilita; retry.
        cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
        cy.get('[data-cy="pdv-finalize-sale"]', { timeout: 10000 }).should('not.be.disabled').click()

        cy.get('[data-cy="pdv-receipt-order-reference"]', { timeout: 10000 }).should('be.visible')
        pdvSalesCount().then((after) => expect(after - before).to.eq(1))
      })
    })
  })

  it('10. finalizar baixa o estoque em exatamente 1 e mostra o resumo', () => {
    loadTwoProducts().then(([product]) => {
      stockFor(product.publicCode).then((before) => {
        cy.get('[data-cy="pdv-scan-input"]').type(`${product.publicCode}{enter}`)
        cy.get('[data-cy="pdv-payment-confirm-checkbox"]').check()
        cy.get('[data-cy="pdv-finalize-sale"]').click()

        cy.get('[data-cy="pdv-receipt-order-reference"]', { timeout: 10000 })
          .invoke('text')
          .should('match', /^PDV-/)
        cy.get('[data-cy="pdv-receipt-item"]').should('contain', product.name)

        stockFor(product.publicCode).then((after) => expect(before - after).to.eq(1))
      })
    })
  })
})
