/// <reference types="cypress" />

describe('Authentication UI states', () => {
  it('shows the approved premium login hierarchy and inline validation', () => {
    cy.viewport(390, 844)
    cy.visit('/login')

    cy.contains('Entre na sua conta').should('be.visible')
    cy.contains('Use suas credenciais administrativas para continuar.').should('be.visible')
    cy.contains('button', 'Entrar no BipFlow').click()

    cy.contains('Informe seu email administrativo.').should('be.visible')
    cy.contains('Informe sua senha.').should('be.visible')
    cy.get('#admin-email').should('have.attr', 'aria-invalid', 'true')
    cy.get('#admin-password').should('have.attr', 'aria-invalid', 'true')
  })

  it('explains why a protected session returned to login', () => {
    cy.visit('/login?reason=session_expired')

    cy.get('[data-cy="session-notice"]')
      .should('be.visible')
      .and('contain.text', 'Sua sessão expirou')
  })

  it('renders rate limiting as a critical inline state', () => {
    cy.intercept('POST', '**/auth/token/', {
      statusCode: 429,
      headers: { 'retry-after': '120' },
      body: { detail: 'rate limited' },
    }).as('loginRequest')

    cy.visit('/login')
    cy.get('#admin-email').type('admin@example.com')
    cy.get('#admin-password').type('senha-invalida')
    cy.contains('button', 'Entrar no BipFlow').click()

    cy.wait('@loginRequest')
    cy.get('[data-cy="login-error"]')
      .should('be.visible')
      .and('contain.text', 'Tente novamente em 2 min')
  })

  it('keeps customer login visibly separate from the admin experience', () => {
    cy.viewport(390, 844)
    cy.visit('/entrar')

    cy.contains('Que bom ter você aqui').should('be.visible')
    cy.contains('Painel administrativo').should('not.exist')
    cy.contains('button', 'Entrar na minha conta').click()
    cy.contains('Informe seu email.').should('be.visible')
    cy.contains('Informe sua senha.').should('be.visible')
  })
})
