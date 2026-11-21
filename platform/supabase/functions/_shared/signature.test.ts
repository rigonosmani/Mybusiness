import { describe, expect, it } from "vitest";
import { hmacHex, verifySignedRequest } from "./signature.ts";

describe("provider callback signatures", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ action: "debit", amount: 100 });
  it("accepts a fresh, correctly signed request", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await hmacHex(secret, `${ts}.${body}`);
    expect(await verifySignedRequest({ secret, timestamp: ts, signature: sig, body })).toEqual({ ok: true });
  });
  it("rejects tampering, replays outside the window and missing config", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await hmacHex(secret, `${ts}.${body}`);
    expect(await verifySignedRequest({ secret, timestamp: ts, signature: sig, body: body + " " })).toMatchObject({ ok: false, reason: "bad_signature" });
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const oldSig = await hmacHex(secret, `${old}.${body}`);
    expect(await verifySignedRequest({ secret, timestamp: old, signature: oldSig, body })).toMatchObject({ ok: false, reason: "stale" });
    expect(await verifySignedRequest({ secret: "", timestamp: ts, signature: sig, body })).toMatchObject({ ok: false, reason: "not_configured" });
  });
});
