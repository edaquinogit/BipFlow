# Production Go-Live Checklist

Use this checklist before accepting real storefront orders.

## Executable Check

Run after migrations and after configuring the production environment:

```powershell
python bipdelivery\manage.py check_go_live_readiness --strict
```

The command verifies:

- debug mode is disabled;
- host, CORS and CSRF allowlists are configured for HTTPS production domains;
- production storage choices are not local-only;
- at least one dashboard operator exists;
- store WhatsApp is configured;
- catalog has sellable products with stock;
- each delivery-enabled store has at least one active delivery region
  (pickup-only stores no longer require one);
- each active store has a valid commercial config accepting orders
  (`commerce` check: non-negative minimum, a delivery mode and a payment
  method while orders are enabled; a store with `orders_enabled=false` is a
  strict-mode blocker, reported as a warning otherwise).

## Manual Smoke

1. Open the public storefront on the production domain.
2. Add an available product to the cart.
3. Choose an active delivery region.
4. Finish checkout.
5. Confirm the generated WhatsApp message opens for the store number.
6. Log in to the dashboard.
7. Confirm the order appears in recent sales with `Pagamento pendente`.
8. Move the order status from `Novo` to `Enviado` or `Cancelado`.
9. In the order detail, confirm the payment (`Confirmar pagamento`) and
   check that the payment badge and history update without a reload.
10. Open **Configurações → Vendas online** and confirm the store's
    commercial rules (accepting orders, delivery modes, payment methods,
    minimum order) render and save.

## Authentication And Session Smoke

Run this block before go-live approval. It catches exactly the class of
regressions where a browser refresh kicks users back to login.

1. Open the storefront in the canonical URL only (do not mix `localhost` and
	 `127.0.0.1` during the same validation session).
2. Log into the dashboard.
3. Open a protected dashboard route (`/dashboard/produtos`, for example).
4. Refresh the browser tab.
5. Confirm the route stays in dashboard (no redirect to `/login`).
6. Open a public storefront route (`/l/default/produtos`) in another tab.
7. Refresh the public tab.
8. Confirm it stays public and is not redirected to login.

## Deployment Mode Checklist

Choose exactly one mode and validate only that mode.

### Single-Origin (recommended default)

- Frontend and backend share one HTTPS domain (reverse proxy serves `/api`).
- `BIPFLOW_CROSS_ORIGIN_COOKIES` is unset or `False`.
- `VITE_API_URL=/api/`.
- `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` include only the canonical
	frontend domain.

### Split-Origin (frontend and backend in different domains)

- `BIPFLOW_CROSS_ORIGIN_COOKIES=True`.
- Backend served over HTTPS.
- Frontend served over HTTPS.
- `CORS_ALLOWED_ORIGINS` contains exact frontend origin(s).
- `CSRF_TRUSTED_ORIGINS` contains exact frontend origin(s).
- `FRONTEND_BASE_URL` points to the canonical frontend URL.

## Quick API Health Verification

Run from a machine that can reach production:

```powershell
curl -i https://SEU_BACKEND/api/auth/token/refresh/
curl -i https://SEU_BACKEND/api/auth/me/
```

Expected:

- `token/refresh` without cookie should fail gracefully (4xx), not 5xx.
- `auth/me` without auth should return 401.
- Neither call should return CORS/preflight failures in browser network logs.

## Operational Baseline

- PostgreSQL backup and restore path are known.
- Product images are persisted outside ephemeral container storage.
- Runtime logs are accessible to the operator.
- Secrets are injected by the deployment platform or secret manager.
- Rollback command or previous image tag is known before deploy.
