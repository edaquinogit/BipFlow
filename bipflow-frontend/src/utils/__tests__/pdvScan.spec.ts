import { describe, it, expect } from "vitest";
import { extractPublicCodeFromScan, parseScanPayload } from "../pdvScan";

describe("extractPublicCodeFromScan", () => {
  it("extracts the public_code from a full deep-link URL", () => {
    expect(
      extractPublicCodeFromScan("https://app.bipflow.com/l/minha-loja/p/ABC123XYZ")
    ).toBe("ABC123XYZ");
  });

  it("extracts the public_code when the URL has a trailing slash", () => {
    expect(
      extractPublicCodeFromScan("https://app.bipflow.com/l/minha-loja/p/ABC123XYZ/")
    ).toBe("ABC123XYZ");
  });

  it("works regardless of host/protocol (dev, LAN, prod)", () => {
    expect(extractPublicCodeFromScan("http://127.0.0.1:5173/l/loja-x/p/CODE1")).toBe(
      "CODE1"
    );
  });

  it("strips a trailing query string or fragment after the code", () => {
    expect(
      extractPublicCodeFromScan("https://app.bipflow.com/l/minha-loja/p/ABC123?utm=qr")
    ).toBe("ABC123");
    expect(
      extractPublicCodeFromScan("https://app.bipflow.com/l/minha-loja/p/ABC123#top")
    ).toBe("ABC123");
  });

  it("returns a bare code unchanged (trimmed) -- manual typing / HID scanner behavior", () => {
    expect(extractPublicCodeFromScan("ABC123XYZ")).toBe("ABC123XYZ");
    expect(extractPublicCodeFromScan("  abc123xyz  ")).toBe("abc123xyz");
  });

  it("returns an empty string unchanged", () => {
    expect(extractPublicCodeFromScan("")).toBe("");
    expect(extractPublicCodeFromScan("   ")).toBe("");
  });

  it("returns garbage input unchanged when it doesn't match the deep-link shape", () => {
    expect(extractPublicCodeFromScan("not a url at all")).toBe("not a url at all");
    expect(extractPublicCodeFromScan("https://example.com/other/path")).toBe(
      "https://example.com/other/path"
    );
  });
});

describe("parseScanPayload (hardening)", () => {
  it("accepts a product deep-link URL and returns just the code", () => {
    expect(parseScanPayload("https://bipflow.pages.dev/l/loja/p/ABCD2345")).toEqual({
      ok: true,
      code: "ABCD2345",
    });
  });

  it("accepts a bare code from a HID reader / manual typing", () => {
    expect(parseScanPayload("ABCD2345")).toEqual({ ok: true, code: "ABCD2345" });
    expect(parseScanPayload("  7891234567895  ")).toEqual({ ok: true, code: "7891234567895" });
  });

  it("rejects an empty payload", () => {
    expect(parseScanPayload("")).toEqual({ ok: false, reason: "empty" });
    expect(parseScanPayload("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects an over-long payload before doing anything else", () => {
    expect(parseScanPayload("A".repeat(513))).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects a script / data scheme and raw markup", () => {
    for (const evil of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>x</script>",
      "<img src=x onerror=alert(1)>",
      "vbscript:msgbox",
    ]) {
      expect(parseScanPayload(evil)).toEqual({ ok: false, reason: "unsupported" });
    }
  });

  it("rejects a payload carrying control characters or whitespace", () => {
    expect(parseScanPayload("ABC\u0000DEF")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseScanPayload("ABC\nDEF")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseScanPayload("ABC\tDEF")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseScanPayload("ABC DEF")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseScanPayload("ABC\u00a0DEF")).toEqual({ ok: false, reason: "unsupported" });
  });

  it("rejects an arbitrary URL that is not a product deep-link", () => {
    expect(parseScanPayload("https://evil.example/phish")).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(parseScanPayload("ftp://host/x")).toEqual({ ok: false, reason: "unsupported" });
    // A bare `/p/CODE` without the `/l/<slug>/` segment is not our shape.
    expect(parseScanPayload("https://x.test/p/ABCD2345")).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("still extracts the code from a deep-link regardless of host (server scope is the real gate)", () => {
    expect(parseScanPayload("http://192.168.0.5:5173/l/loja/p/ABCD2345")).toEqual({
      ok: true,
      code: "ABCD2345",
    });
  });

  it("rejects a non-string payload", () => {
    expect(parseScanPayload(null)).toEqual({ ok: false, reason: "unsupported" });
    expect(parseScanPayload(12345)).toEqual({ ok: false, reason: "unsupported" });
  });
});
