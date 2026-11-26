# Etapa 4: snapshot logistico

Migration 0053 adds SaleOrder.shipping_snapshot (empty object for legacy orders).
The optional national_shipping checkout input contains destination_postal_code,
state (Brazilian UF), service and expected_price. Only delivery without a local region is accepted.
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
The public preview returns order_confirmation_available; only when true may the UI submit a national selection. CEP, cart and tenant changes invalidate selection. Explicit local choice is required after invalidation.
The quote API accepts product_id and quantity only; variants inherit parent logistics, while checkout carries variant_id for stock and pricing. UF membership is validated, not geographic correspondence between CEP, city and UF.
CI #160 on c5934e3 passed all five jobs. Stage 5 adds further QA; this is not authorization for production.
No real carrier integration or official rates.
