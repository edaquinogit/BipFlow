import { describe, it, expect, vi, afterEach } from "vitest";
import { newIdempotencyKey } from "../idempotency";

const BACKEND_CONTRACT = /^[A-Za-z0-9:_-]{8,128}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newIdempotencyKey", () => {
  it("returns a value matching the backend contract", () => {
    expect(newIdempotencyKey()).toMatch(BACKEND_CONTRACT);
  });

  it("returns a distinct value each call", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });

  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "11111111-2222-3333-4444-555555555555");
    vi.stubGlobal("crypto", { randomUUID });
    expect(newIdempotencyKey()).toBe("11111111-2222-3333-4444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to a timestamp+random key without crypto", () => {
    vi.stubGlobal("crypto", {});
    const key = newIdempotencyKey();
    expect(key).toMatch(BACKEND_CONTRACT);
  });
});
