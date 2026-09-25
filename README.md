# Bip Flow

**Multi-store commerce management built around everyday retail operations.**

Bip Flow brings product catalogs, inventory, orders, point of sale, and online
storefronts into one application. It is an independent project informed by my
experience with e-commerce operations, marketplace tools, and order fulfillment.

**[Open application](https://bipflow.pages.dev/login)** ·
[Architecture](docs/architecture/system-overview.md) ·
[Development guide](docs/development-guide.md) ·
[CI results](https://github.com/edaquinogit/BipFlow/actions/workflows/ci.yml)

The application link opens the login page. Administrative features require an
authorized account. For a walkthrough without dashboard access, see the
[product demonstration](https://www.linkedin.com/posts/ednaldo-aquino-backend_opentowork-vagasti-desenvolvedor-ugcPost-7455073194668888064-kCBE).

## The problem

Small retailers selling through messaging apps often manage product availability,
delivery fees, and order history across separate tools. Bip Flow connects these
steps: a customer browses a store, builds a cart, selects delivery, and submits an
order that the backend validates and saves before handing the conversation to WhatsApp.

Store teams use the dashboard to manage their catalog, stock, and orders.
In-person sales use the point-of-sale workflow and share the order history,
while retaining their own channel and payment rules.

## Product scope

| Area | Implemented capabilities |
| --- | --- |
| Storefront | Public catalog, product details, categories, store-specific cart, and branding |
| Checkout | Server-side totals, delivery-region fees, store commerce rules, and WhatsApp handoff |
| Operations | Catalog management, stock movements, order history, and operational status changes |
| Point of sale | Product lookup by public code/QR, stock deduction, and receipts |
| Multiple stores | Store memberships, store switching, scoped business data, and access permissions |
| Payment tracking | Controlled status transitions with an append-only audit history |

**Scope boundary:** payment tracking records events handled outside the platform.
Bip Flow does not charge customers or execute refunds. An order submitted through
WhatsApp is not automatically a confirmed payment.

## Architecture

The main application is a Django REST backend and a Vue frontend.
Docker Compose runs PostgreSQL and Redis alongside them.

| Component | Responsibility |
| --- | --- |
| Vue 3 + TypeScript | Storefront and dashboard; HTTP access through services and reusable UI state |
| Django REST Framework | Authentication, authorization, tenant resolution, and business rules |
| PostgreSQL | Relational storage in the Compose environment |
| Redis | Shared cache and throttling in the Compose environment |
| Nginx + Gunicorn | Serve the frontend build and route API requests to Django |

The standalone local backend can use SQLite. Environment-specific setup is
documented in the [development guide](docs/development-guide.md).
The archived Node engine and the isolated order-validation package are outside
the main runtime.

## Engineering decisions worth reviewing

### Business rules stay on the server

Prices, stock availability, delivery fees, and order totals are validated by the
backend. The frontend presents the workflow; it does not determine authoritative
commercial values.

Start with the [API reference](docs/api/reference.md) and
[checkout rule tests](bipdelivery/tests/test_checkout_commerce_rules.py).

### Store isolation uses a shared database

Business records carry a `store_id`. Request-scoped tenant resolution and scoped
querysets separate store data, while membership and role checks govern access.

This keeps stores within one application and schema, but makes consistent
server-side scoping essential. A default store remains for legacy links and local
development; privileged platform users have broader access.

Review [tenant resolution](bipdelivery/api/store_scope.py),
[isolation security tests](bipdelivery/tests/test_store_isolation_security.py), and
the [multi-store design](docs/architecture/multi-tenant-evolution.md).

### Payment changes are explicit and auditable

The payment state machine validates allowed transitions and writes the status
change and audit event in the same transaction. Row locking serializes updates
to an order; repeating its current status is a no-op.

Cancellation of a paid order records a pending refund rather than pretending that
money has already been returned.

Review the [payment implementation](bipdelivery/api/payments.py) and
[payment lifecycle tests](bipdelivery/tests/test_payment_lifecycle.py).

## Run locally

**Requirements:** Git, Docker with Compose, and Python 3.12 for the secret-generation helper.
Run the following from a new checkout:

```bash
git clone https://github.com/edaquinogit/BipFlow.git
cd BipFlow
cp .env.example .env
python scripts/generate-secrets.py --env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Use `python3` if that is the name of your Python 3.12 interpreter.

For local administrative access, configure `DJANGO_BOOTSTRAP_ADMIN_EMAIL`,
`DJANGO_BOOTSTRAP_ADMIN_PASSWORD`, and `DJANGO_BOOTSTRAP_ADMIN_ROLE=admin`
in your local `.env` before the first boot. Choose your own password.

```bash
docker compose up --build
```

Open [localhost:8080](http://localhost:8080/).
The backend entrypoint runs migrations and initializes access groups.
The frontend container serves a static build; rebuild it to see source changes.
Public registration alone does not grant dashboard privileges.

For native Python/Vite development, test data, environment configuration, and
troubleshooting, follow the [development guide](docs/development-guide.md)
and [frontend guide](bipflow-frontend/README.md).

## Quality and verification

The repository includes backend tests, frontend unit tests, and Cypress end-to-end
tests. Review [workflow definitions](.github/workflows/ci.yml) and
[current CI runs](https://github.com/edaquinogit/BipFlow/actions/workflows/ci.yml)
for execution results associated with a specific revision.

After installing dependencies and configuring your local environment:

```bash
python bipdelivery/manage.py check
python -m pytest bipdelivery/tests
ruff check bipdelivery/api bipdelivery/tests
npm run frontend:typecheck
npm run frontend:lint
npm run frontend:test:unit
npm run frontend:build
npm run docs:check
```

For Cypress, prepare the backend, test user, and E2E environment as described in
the [test setup](docs/development-guide.md), then run `npm run frontend:test:e2e`.
Test counts and deployment readiness depend on the revision and environment;
the README does not replace those checks.

## Repository guide

| Path | Start here for |
| --- | --- |
| [bipdelivery/api/](bipdelivery/api/) | Models, API endpoints, permissions, tenant scope, and domain logic |
| [bipdelivery/tests/](bipdelivery/tests/) | Backend behavior and regression tests |
| [bipflow-frontend/src/](bipflow-frontend/src/) | Vue application, services, views, types, and schemas |
| [bipflow-frontend/cypress/](bipflow-frontend/cypress/) | Browser-based workflow tests |
| [docs/](docs/) | Setup, architecture, API contracts, and feature documentation |
| [legacy/](legacy/) | Archived code outside the main application |

## Further reading

- [Technical review guide](docs/technical-delivery.md)
- [Online sales and payment design](docs/architecture/online-sales-foundation.md)
- [Production readiness checklist](docs/production-go-live.md)
- [Documentation index](docs/README.md)
- [Architecture presentation](https://www.linkedin.com/posts/ednaldo-aquino-backend_estagio-opentowork-desenvolvedor-ugcPost-7454498028276760578-zi7X)

## Author

Developed by **Ednaldo Aquino**, an IT Management student and Software Engineering
Intern. This independent project connects my e-commerce background with continued
practice in backend development, testing, and software design.

[GitHub](https://github.com/edaquinogit) ·
[LinkedIn](https://www.linkedin.com/in/ednaldo-aquino-ednaldo)

## License

See [LICENSE](LICENSE).
