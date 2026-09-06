/// <reference types="cypress" />
/**
 * BipFlow COMMERCE P1 -- Merchant Profile settings tab.
 *
 * login -> Configuracoes -> aba "Perfil da loja" -> edit trade name +
 * Instagram -> save -> reload -> values persisted.
 *
 * Idempotent: every run writes the same known values, so it does not depend
 * on (or leave behind) a particular DB state.
 */

const apiBaseUrl = () =>
  String(Cypress.env('apiBaseUrl') || 'http://localhost:8000/api').replace(/\/$/, '');

describe('Settings: Merchant Profile', () => {
  const TRADE_NAME = 'Loja E2E';
  const INSTAGRAM = 'https://instagram.com/loja-e2e';

  beforeEach(() => {
    cy.loginViaApi();
  });

  it('persists commercial identity and social links across a reload', () => {
    cy.visitWithAuth('/dashboard/configuracoes');

    cy.get('[data-cy="settings-tab-perfil"]').click();

    cy.get('[data-cy="merchant-trade-name"]', { timeout: 10000 })
      .should('be.visible')
      .clear()
      .type(TRADE_NAME);
    cy.get('[data-cy="merchant-instagram"]').clear().type(INSTAGRAM);

    cy.get('[data-cy="btn-save-merchant-profile"]').should('not.be.disabled').click();

    cy.get('[data-cy="toast-container"]').should('contain', 'Perfil da loja atualizado.');

    cy.reload();
    cy.get('[data-cy="settings-tab-perfil"]').click();

    cy.get('[data-cy="merchant-trade-name"]').should('have.value', TRADE_NAME);
    cy.get('[data-cy="merchant-instagram"]').should('have.value', INSTAGRAM);
  });

  it('never exposes the private tax id on the public storefront contract', () => {
    // Seed a tax id through the authenticated endpoint...
    const token = () => (Cypress.env('authTokens') as { access: string }).access;
    cy.request({
      method: 'PATCH',
      url: `${apiBaseUrl()}/v1/store/current/merchant-profile/`,
      headers: { Authorization: `Bearer ${token()}` },
      body: { tax_id: '11.222.333/0001-81', trade_name: TRADE_NAME },
    }).its('status').should('eq', 200);

    // ...and confirm the public storefront appearance never echoes it.
    cy.request(`${apiBaseUrl()}/v1/public/stores/default/appearance/`).then((response) => {
      expect(response.status).to.eq(200);
      expect(Object.keys(response.body.merchant).sort()).to.deep.equal([
        'city',
        'facebook_url',
        'instagram_url',
        'state',
        'tiktok_url',
        'trade_name',
        'website_url',
        'youtube_url',
      ]);
      expect(JSON.stringify(response.body)).not.to.contain('11222333000181');
    });
  });
});
