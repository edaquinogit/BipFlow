/**
 * Cash payment maths for the PDV (PDV/QR/payment evolution, see
 * docs/architecture/pdv-qr-payment-evolution.md).
 *
 * All arithmetic is done in integer cents so "recebi 50,00 para um total de
 * 33,30" never lands on 16.699999999999999. The backend still recomputes and
 * is the authority on the sale total; this only drives the change display
 * and the "valor insuficiente" guard on the finalize button.
 */

/** Parse a BR-or-plain money string ("50", "50,00", "50.00", "R$ 50,00")
 * into integer cents. Returns null for anything that isn't a number. */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  if (typeof input !== "string") {
    return null;
  }

  let cleaned = input.trim().replace(/[R$\s\u00a0]/gi, "");
  if (!cleaned) {
    return null;
  }

  // Normalise decimal separator: if both "," and "." appear, the last one is
  // the decimal separator and the other is a thousands separator.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    cleaned = cleaned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(",", ".");
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  return Math.round(Number(cleaned) * 100);
}

export interface ChangeCalculation {
  /** Parsed amount handed over, in reais. 0 when the field is blank/invalid. */
  received: number;
  /** Sale total, in reais. */
  total: number;
  /** Whether the received amount covers the total. */
  isSufficient: boolean;
  /** Change owed to the customer, in reais. 0 when insufficient. */
  change: number;
  /** How much is still missing, in reais. 0 when sufficient. */
  missing: number;
  /** false when the field is empty or unparseable (distinct from "0"). */
  hasAmount: boolean;
}

export function calculateChange(
  receivedInput: string | number | null | undefined,
  total: number,
): ChangeCalculation {
  const totalCents = Math.max(0, Math.round((Number.isFinite(total) ? total : 0) * 100));
  const receivedCents = parseMoneyToCents(receivedInput);
  const hasAmount = receivedCents !== null;
  const safeReceived = receivedCents ?? 0;
  const isSufficient = hasAmount && safeReceived >= totalCents;

  return {
    received: safeReceived / 100,
    total: totalCents / 100,
    isSufficient,
    change: isSufficient ? (safeReceived - totalCents) / 100 : 0,
    missing: hasAmount && safeReceived < totalCents ? (totalCents - safeReceived) / 100 : 0,
    hasAmount,
  };
}
