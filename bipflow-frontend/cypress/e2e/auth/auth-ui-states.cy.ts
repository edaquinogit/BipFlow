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

  it('renders the animated brand mark: official asset, exactly three bars, transform/opacity only', () => {
    cy.viewport(1280, 800)
    cy.visit('/login')

    cy.get('[data-cy="auth-brand-mark"]').should('have.length.at.least', 1)
    cy.get('[data-cy="auth-brand-mark"]').first().within(() => {
      cy.get('img').should('have.attr', 'src', '/brand/bipflow-logo-auth.webp')
      cy.get('.auth-brand-mark__bar').should('have.length', 3)
    })

    cy.get('[data-cy="auth-brand-mark"]').first().find('.auth-brand-mark__bar').each(($bar, index) => {
      const cs = getComputedStyle($bar[0])
      expect(cs.animationName, `bar ${index} animation-name`).to.match(/auth-brand-bar-drift/)
      expect(cs.animationDuration, `bar ${index} duration`).to.eq('4.6s')
      expect(cs.animationTimingFunction, `bar ${index} easing`).to.eq('cubic-bezier(0.22, 1, 0.36, 1)')
      expect(['0s', '0.18s', '0.36s'], `bar ${index} delay`).to.include(cs.animationDelay)
    })
  })

  it('mobile login (360x740): compact mark, dark panel hidden, no overflow, 24px gutters, tappable controls', () => {
    cy.viewport(360, 740)
    cy.visit('/login')

    cy.contains('Entre na sua conta').should('be.visible')
    // dark institutional panel is display:none below lg
    cy.get('[aria-label="Apresentação do BipFlow Manage"]').should('not.be.visible')
    // compact mark above the form
    cy.get('.lg\\:hidden [data-cy="auth-brand-mark"]').should('be.visible')

    cy.document().then((doc) => {
      const el = doc.documentElement
      expect(el.scrollWidth, 'no horizontal overflow').to.be.at.most(el.clientWidth + 1)
    })

    cy.get('.auth-form-panel').then(($p) => {
      const cs = getComputedStyle($p[0])
      expect(parseFloat(cs.paddingLeft), 'left gutter >= 24px').to.be.gte(24)
      expect(parseFloat(cs.paddingRight), 'right gutter >= 24px').to.be.gte(24)
    })

    cy.get('#admin-email').then(($i) => {
      expect(parseFloat(getComputedStyle($i[0]).fontSize), 'input font-size >= 16px').to.be.gte(16)
      expect($i[0].getBoundingClientRect().height, 'input height >= 44px').to.be.gte(44)
    })
    cy.contains('button', 'Entrar no BipFlow').then(($b) => {
      expect($b[0].getBoundingClientRect().height, 'CTA height >= 44px').to.be.gte(44)
    })
    cy.contains('a', 'Esqueci minha senha').should('be.visible')
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
