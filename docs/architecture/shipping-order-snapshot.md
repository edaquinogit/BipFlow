# Etapa 4: snapshot logistico

Migration 0053 adds SaleOrder.shipping_snapshot (empty object for legacy orders).
The optional national_shipping checkout input contains destination_postal_code,
service and expected_price. Only delivery without a local region is accepted.
The existing checkout reserves stock in its transaction; confirmation recalculates
the selected service using the resolved store and locked shipping configuration.
A price mismatch or disabled flag rolls back the transaction. The expected price
is a comparison value, never the source of the persisted fee.
The national selection participates in the idempotency hash only when supplied.
National orders use delivery_method=delivery and snapshot.kind=national_simulated.
Local orders and pickup retain their existing behavior.

Two gates are required: national_shipping_enabled for the tenant and Django
setting BIPFLOW_SIMULATED_NATIONAL_CHECKOUT (absent/false by default).
The latter is intended for isolated tests only; no production activation.
The public preview remains demonstrative and does not submit national checkout.
Remaining work: frontend confirmation UX, address/state validation, dedicated
cross-tenant and migration regression tests, CI and end-to-end validation.
No real carrier integration or official rates.
