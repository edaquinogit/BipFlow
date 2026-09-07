/// <reference types="cypress" />

describe('Authentication UI states', () => {
  it('shows the approved premium login hierarchy and inline validation', () => {
    cy.viewport(390, 844)
    cy.visit('/login')

    cy.get('[aria-label="Apresentação do Bip Flow"]').should('not.be.visible')
    cy.get('[data-cy="auth-brand-mark"]:visible')
      .should('have.length', 1)
      .find('.auth-brand-mark__speed-line')
      .should('have.length', 3)
    cy.contains('Entre na sua conta').should('be.visible')
    cy.contains('Use suas credenciais administrativas para continuar.').should('be.visible')
    cy.contains('button', 'Entrar no Bip Flow').click()

    cy.contains('Informe seu email administrativo.').should('be.visible')
    cy.contains('Informe sua senha.').should('be.visible')
    cy.get('#admin-email').should('have.attr', 'aria-invalid', 'true')
    cy.get('#admin-password').should('have.attr', 'aria-invalid', 'true')

    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth, 'mobile login has no horizontal overflow')
        .to.be.at.most(doc.documentElement.clientWidth + 1)
    })
  })

  it('keeps controls readable and touch-friendly at the compact mobile breakpoint', () => {
    cy.viewport(360, 740)
    cy.visit('/login')

    cy.get('#admin-email').should('have.css', 'font-size', '16px')
    cy.get('#admin-password').should('have.css', 'font-size', '16px')
    cy.contains('button', 'Entrar no Bip Flow').then(($button) => {
      expect($button[0].getBoundingClientRect().height, 'primary action height').to.be.at.least(44)
    })
    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth, 'compact login has no horizontal overflow')
        .to.be.at.most(doc.documentElement.clientWidth + 1)
    })
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
      // The app and API use different origins in CI and production. Mirror
      // the API's CORS contract so browser code can read Retry-After.
      headers: {
        'retry-after': '120',
        'access-control-expose-headers': 'Retry-After',
      },
      body: { detail: 'rate limited' },
    }).as('loginRequest')

    cy.visit('/login')
    cy.get('#admin-email').type('admin@example.com')
    cy.get('#admin-password').type('senha-invalida')
    cy.contains('button', 'Entrar no Bip Flow').click()

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
