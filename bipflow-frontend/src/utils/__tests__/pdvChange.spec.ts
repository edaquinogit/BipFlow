import { describe, it, expect } from "vitest";
import { calculateChange, parseMoneyToCents } from "../pdvChange";

describe("parseMoneyToCents", () => {
  it("parses plain and BR-formatted money strings", () => {
    expect(parseMoneyToCents("50")).toBe(5000);
    expect(parseMoneyToCents("50,00")).toBe(5000);
    expect(parseMoneyToCents("50.00")).toBe(5000);
    expect(parseMoneyToCents("1.234,50")).toBe(123450);
    expect(parseMoneyToCents("1,234.50")).toBe(123450);
    expect(parseMoneyToCents("R$ 33,30")).toBe(3330);
    expect(parseMoneyToCents(33.3)).toBe(3330);
  });

  it("returns null for blank or non-numeric input", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
  });
});

describe("calculateChange", () => {
  it("computes change without floating-point drift", () => {
    const result = calculateChange("50,00", 33.3);
    expect(result.isSufficient).toBe(true);
    expect(result.change).toBe(16.7);
    expect(result.missing).toBe(0);
    expect(result.hasAmount).toBe(true);
  });

  it("flags an insufficient amount and reports what is missing", () => {
    const result = calculateChange("20", 33.3);
    expect(result.isSufficient).toBe(false);
    expect(result.change).toBe(0);
    expect(result.missing).toBeCloseTo(13.3, 2);
  });

  it("treats an exact amount as sufficient with zero change", () => {
    const result = calculateChange("33,30", 33.3);
    expect(result.isSufficient).toBe(true);
    expect(result.change).toBe(0);
  });

  it("reports hasAmount=false for a blank field (distinct from R$ 0,00)", () => {
    const result = calculateChange("", 33.3);
    expect(result.hasAmount).toBe(false);
    expect(result.isSufficient).toBe(false);
  });

  it("never returns a negative total for a nonsensical sale total", () => {
    const result = calculateChange("10", Number.NaN);
    expect(result.total).toBe(0);
    expect(result.isSufficient).toBe(true);
  });
});
