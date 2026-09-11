/**
 * A fresh opaque idempotency key. Format matches the backend contract
 * (`[A-Za-z0-9:_-]{8,128}`, see CheckoutRequestSerializer and
 * bipdelivery/api/pdv.py): a UUID where the platform provides one, a
 * timestamp+random fallback otherwise. Callers keep one value per logical
 * operation (e.g. one running PDV cart) and reuse it across every retry of
 * that operation, so a duplicate submit can be recognised server-side.
 */
export function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
