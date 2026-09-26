/// <reference types="cypress" />
/**
 * Real decoder against a real QR -- the piece unit tests can't cover.
 *
 * The QR comes from the backend's `GET /v1/products/{id}/qr-code/`, i.e. the
 * exact image `product_labels.build_product_qr_code_data_uri()` prints on a
 * label. It is decoded back with `qr-scanner`'s own engine (native
 * BarcodeDetector where the browser has it, WASM worker otherwise) -- the
 * same engine `usePdvCameraScanner` runs on a live camera frame -- then the
 * decoded string is pushed through the real `parseScanPayload` /
 * `extractPublicCodeFromScan` and the real PDV screen.
 *
 * Covers: exact payload round-trip, a downscaled render, a slight rotation,
 * a garbage image, and the full scan -> cart pipeline.
 */
import QrScanner from 'qr-scanner'
import { extractPublicCodeFromScan, parseScanPayload } from '@/utils/pdvScan'

const apiBaseUrl = () =>
  (Cypress.env('apiBaseUrl') || 'http://localhost:8000/api').replace(/\/$/, '')

function authHeaders() {
  const t = Cypress.env('authTokens') as { access: string } | undefined
  if (!t?.access) throw new Error('call cy.loginViaApi() first')
  return { Authorization: `Bearer ${t.access}` }
}

interface QrProduct {
  id: number
  publicCode: string
  url: string
  dataUri: string
}

function firstQrProduct(): Cypress.Chainable<QrProduct> {
  return cy
    .request({ url: `${apiBaseUrl()}/v1/products/?page_size=20`, headers: authHeaders() })
    .then((r) => {
      const p = (r.body.results ?? r.body).find(
        (x: Record<string, unknown>) => Number(x.stock_quantity) > 2 && x.is_available,
      )
      expect(p, 'a usable seeded product').to.exist
      return cy
        .request({ url: `${apiBaseUrl()}/v1/products/${p.id}/qr-code/`, headers: authHeaders() })
        .then((q) => ({
          id: p.id as number,
          publicCode: q.body.public_code as string,
          url: q.body.url as string,
          dataUri: q.body.qr_code as string,
        }))
    })
}

/** Load a data URI into an <img>, optionally redraw it scaled/rotated on a
 * canvas, and hand the element/canvas to qr-scanner for a real decode. */
function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = dataUri
  })
}

function redraw(
  img: HTMLImageElement,
  opts: { scale?: number; rotateDeg?: number },
): HTMLCanvasElement {
  const scale = opts.scale ?? 1
  const rot = ((opts.rotateDeg ?? 0) * Math.PI) / 180
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  // pad so a rotated QR isn't clipped
  const pad = Math.ceil(Math.max(w, h) * 0.4)
  canvas.width = w + pad * 2
  canvas.height = h + pad * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(rot)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  return canvas
}

describe('PDV -- real QR decode round-trip', () => {
  before(() => cy.loginViaApi())

  it('decodes the label QR back to the exact deep-link URL', () => {
    firstQrProduct().then((product) => {
      cy.wrap(
        loadImage(product.dataUri).then((img) =>
          QrScanner.scanImage(img, { returnDetailedScanResult: true }),
        ),
      ).then((result: any) => {
        expect(result.data).to.eq(product.url)
        expect(extractPublicCodeFromScan(result.data)).to.eq(product.publicCode)
        expect(parseScanPayload(result.data)).to.deep.eq({
          ok: true,
          code: product.publicCode,
        })
      })
    })
  })

  it('still decodes when the QR is rendered small (65%)', () => {
    firstQrProduct().then((product) => {
      cy.wrap(
        loadImage(product.dataUri)
          .then((img) => redraw(img, { scale: 0.65 }))
          .then((canvas) => QrScanner.scanImage(canvas, { returnDetailedScanResult: true })),
      ).then((result: any) => {
        expect(result.data).to.eq(product.url)
      })
    })
  })

  it('still decodes with a slight rotation (12deg)', () => {
    firstQrProduct().then((product) => {
      cy.wrap(
        loadImage(product.dataUri)
          .then((img) => redraw(img, { rotateDeg: 12 }))
          .then((canvas) =>
            QrScanner.scanImage(canvas, {
              returnDetailedScanResult: true,
              alsoTryWithoutScanRegion: true,
            }),
          ),
      ).then((result: any) => {
        expect(result.data).to.eq(product.url)
      })
    })
  })

  it('rejects a non-QR image', () => {
    const blank = document.createElement('canvas')
    blank.width = 200
    blank.height = 200
    const ctx = blank.getContext('2d')!
    ctx.fillStyle = '#cccccc'
    ctx.fillRect(0, 0, 200, 200)
    cy.wrap(
      QrScanner.scanImage(blank, { returnDetailedScanResult: true }).then(
        () => 'DECODED',
        (err: unknown) => `REJECTED:${String(err)}`,
      ),
    ).should('match', /^REJECTED:/)
  })

  it('feeds a decoded QR through the real PDV screen into the cart', () => {
    cy.loginViaApi()
    firstQrProduct().then((product) => {
      cy.request({
        url: `${apiBaseUrl()}/v1/products/${product.id}/`,
        headers: authHeaders(),
      }).then((r) => {
        const name = String(r.body.name)
        cy.visitWithAuth('/dashboard/pdv')
        cy.get('[data-cy="pdv-scan-input"]', { timeout: 15000 }).should('be.visible')
        cy.wrap(
          loadImage(product.dataUri).then((img) =>
            QrScanner.scanImage(img, { returnDetailedScanResult: true }),
          ),
        ).then((result: any) => {
          cy.get('[data-cy="pdv-scan-input"]').type(`${result.data}{enter}`)
          cy.get('[data-cy="pdv-cart-row"]').should('have.length', 1)
          cy.get('[data-cy="pdv-cart-table"]').should('contain', name)
        })
      })
    })
  })
})
