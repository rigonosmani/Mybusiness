/**
 * casino-provider-callback — seamless-wallet endpoint for a licensed aggregator.
 *
 * URL:     https://<project>.supabase.co/functions/v1/casino-provider-callback
 * Headers: x-provider-id, x-timestamp, x-signature = hex HMAC-SHA256(callback_secret, "<ts>.<raw body>")
 * Body:    { token, action: "balance"|"debit"|"credit"|"rollback", transaction_id, round_id, amount, reference_transaction_id? }
 *          amount in units (1 Cr = 100)
 * The callback secret is set in Main admin → Games (encrypted) or PROVIDER_SECRET_<ID>.
 */
import { serviceClient } from "../_shared/supabase.ts";
import { verifySignedRequest } from "../_shared/signature.ts";
import { integrationSecret } from "../_shared/secrets.ts";
import { errorCode } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const providerId = (req.headers.get("x-provider-id") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{2,48}$/.test(providerId)) return Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });

  const svc = serviceClient();
  const raw = await req.text();
  const secret = await integrationSecret(svc, providerId, "callback_secret", `PROVIDER_SECRET_${providerId.toUpperCase()}`);
  const verdict = await verifySignedRequest({
    secret: secret ?? "", timestamp: req.headers.get("x-timestamp"), signature: req.headers.get("x-signature"), body: raw,
  });
  if (!verdict.ok) {
    await svc.rpc("svc_security_event", {
      p_user: null, p_event_type: "provider.bad_signature", p_severity: "critical",
      p_details: { provider: providerId, reason: verdict.reason },
    });
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const b = JSON.parse(raw);
    if (b.action === "balance") {
      const { data, error } = await svc.rpc("svc_provider_balance", { p_provider: providerId, p_token: String(b.token) });
      if (error) throw new Error(error.message);
      return Response.json(data);
    }
    const { data, error } = await svc.rpc("svc_provider_wallet", {
      p_provider: providerId, p_token: String(b.token), p_action: String(b.action),
      p_provider_tx_id: String(b.transaction_id), p_round_ref: String(b.round_id),
      p_amount: Number.isInteger(b.amount) ? b.amount : -1, p_ref_tx_id: b.reference_transaction_id ?? null,
    });
    if (error) throw new Error(error.message);
    return Response.json(data);
  } catch (e) {
    return Response.json({ status: "rejected", error: errorCode(e) }, { status: 400 });
  }
});
