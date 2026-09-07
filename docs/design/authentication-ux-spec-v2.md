# Authentication UX — Spec v2

Status: **approved reference in production**. v2 refines the v1 premium
authentication experience (`feat(auth): refine premium authentication
experience`) on two axes only — an animated brand mark and mobile polish.
Nothing about the auth contract, the copy, or the desktop composition changes.

## Reference

The dashboard login (`/login`, `LoginView.vue` + `AuthShell.vue`) is the
canonical screen. The old interface — a text `BF` placeholder, a bare "Entrar"
title, "Acesse sua conta para gerenciar sua loja" — must never be restored.

## Desktop (≥ 1024px / `lg`)

Two-column grid `minmax(0,1.08fr) minmax(30rem,0.92fr)`.

Left — dark institutional panel (`.auth-brand-panel`, `hidden … lg:flex`):

- `AuthBrandMark` (official `/brand/bipflow-logo-auth.webp`) + wordmark
  "BipFlow Manage" (continuous gradient text, no separator).
- Eyebrow "Painel administrativo".
- Hero "Sua operação, sob controle total."
- Copy "Gerencie produtos, pedidos e atendimento em um painel pensado para o
  dia a dia do seu delivery."
- Three operational benefits (real-time orders, catalog/categories, unified
  service inbox).
- Ambient decoration: dotted grid, two orbits, a soft glow, three drifting
  wave strokes — all `aria-hidden`, all `pointer-events: none`.

Right — light form panel (`.auth-form-panel`), vertically centred from `lg`:

- Eyebrow "Acesso seguro".
- `<h2>` "Entre na sua conta" — `2rem` from `sm` up.
- Subcopy "Use suas credenciais administrativas para continuar."
- `AuthField` email + password (show/hide toggle), remember-me, Turnstile
  when required, `AuthSubmitButton` "Entrar no BipFlow".
- Inline `AuthAlert` states: session-expired / auth-required (info),
  validation hint (warning), credential / rate-limit / connection / captcha
  errors (error). No critical message is toast-only.
- Form column `max-width: 448px`.

## Mobile (< 1024px)

- Dark institutional panel is `display: none` (never rendered visible).
- Compact header: `AuthBrandMark` + "BipFlow Manage" wordmark, above the form.
- Content is **top-aligned** (`justify-start`), re-centred vertically from `lg`.
- Side gutters: **24px** (`px-6`).
- Vertical padding respects the notch and home indicator:
  `padding-top: calc(2rem + env(safe-area-inset-top))`,
  `padding-bottom: calc(2rem + env(safe-area-inset-bottom))`.
- `<h2>` title: **28px** (`text-[1.75rem]`), stepping to 32px at `sm`.
- Inputs: `font-size: 16px` (no iOS zoom), min height 48px.
- CTA and the show/hide toggle: min tap target 44px.
- "Esqueci minha senha" reachable; remember-me checkbox in a 44px-min label.
- No horizontal overflow at 360×740 or 390×844.
- The on-screen keyboard never hides the active field (top-aligned layout +
  `min-h-dvh`).

## Brand mark motion (`AuthBrandMark.vue`)

The logo asset never scales, moves or deforms. Exactly **three** decorative
glow layers (`.auth-brand-mark__bar--1/2/3`) sit over the three pink bars of
the mark:

| Layer | top | left | width | delay |
|---|---|---|---|---|
| 1 | 43.5% | 12% | 17% | 0ms |
| 2 | 52.25% | 7% | 23% | 180ms |
| 3 | 61.5% | 12.5% | 17% | 360ms |

(percentages of the 256×256 asset)

- Animation: `auth-brand-bar-drift`, **4.6s**, `cubic-bezier(0.22, 1, 0.36, 1)`,
  `infinite`.
- Animates **only `transform` (translateX ±8%) and `opacity` (0.32 ↔ 0.9)** —
  never width/height/margin, so there is no layout shift.
- `mix-blend-mode: screen` + a soft pink gradient — a directional glow, not a
  hard flash. The bars do not blink aggressively.
- `pointer-events: none`, `aria-hidden="true"`, `data-cy="auth-brand-mark"`.
- `@media (prefers-reduced-motion: reduce)` removes the animation entirely
  (`animation: none`) and leaves a calm resting glow.

## Accessibility

- `<label for>` bound to every input; `aria-invalid` + `aria-describedby` on
  fields with an error; error text `role="alert"` (assertive), notices
  `role="status"` (polite).
- Show/hide password is a real `<button>` with `aria-label` + `aria-pressed`.
- Visible keyboard focus on every interactive element.
- All decoration is `aria-hidden`; no feature depends on hover.
- `prefers-reduced-motion` honoured by the brand mark, the panel glow and the
  wave strokes.

## Components

- `AuthBrandMark.vue` — official mark + three animated glow bars (new in v2).
- `AuthShell.vue` — two-column shell; uses `AuthBrandMark` on desktop and
  mobile; owns the mobile safe-area / top-alignment rules.
- `LoginView.vue`, `RegisterView.vue`, `ForgotPasswordView.vue`,
  `ResetPasswordView.vue`, `CustomerLoginView.vue` — unchanged contract.
- `AuthField`, `AuthAlert`, `AuthSubmitButton`, `AuthPasswordStrength`,
  `TurnstileWidget` — unchanged.

## Acceptance criteria

1. Desktop 1440×900 / 1280×800 / 1024×768: dark panel visible, official logo,
   wordmark unbroken, "Entre na sua conta", "Entrar no BipFlow", ambient
   decoration subtle, nothing clipped, no console error.
2. `768×1024`: dark panel visible at exactly `lg`.
3. Mobile 390×844 / 360×740: dark panel hidden, compact mark on top, 24px
   gutters, no horizontal scroll, inputs 16px, controls ≥ 44px.
4. Brand mark: exactly three animated bars, `animation-name ≠ none`, duration
   4.6s, delays 0 / 0.18 / 0.36s, only transform/opacity change, container
   size constant.
5. `prefers-reduced-motion: reduce`: `animation-name: none` on the bars.
6. Backend untouched: auth endpoints, JWT/refresh-cookie strategy, MFA,
   captcha and redirects behave exactly as before.

## Out of scope

- Any backend change.
- `is_available`, categories, dashboard pagination, cross-tenant audit trail.
- The storefront customer login visual (kept as its own light card).
- Restyling the ambient wave / orbit / glow decoration.
