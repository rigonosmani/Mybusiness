/**
 * casino-provider-callback — seamless-wallet endpoint for a LICENSED external
 * game provider (none configured by default).
 *
 * Headers: x-provider-id, x-timestamp, x-signature = hex HMAC-SHA256(secret, "<ts>.<body>")
 * Body:    { token, action: "debit"|"credit"|"rollback", transaction_id, round_id, amount, reference_transaction_id? }
 * Secret:  PROVIDER_SECRET_<PROVIDER_ID upper-case>
 */
import { serviceClient } from "../_shared/supabase.ts";
import { verifySignedRequest } from "../_shared/signature.ts";
import { errorCode } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const providerId = (req.headers.get("x-provider-id") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{2,48}$/.test(providerId)) return Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });

  const raw = await req.text();
  const verdict = await verifySignedRequest({
    secret: Deno.env.get(`PROVIDER_SECRET_${providerId.toUpperCase()}`) ?? "",
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    body: raw,
  });
  const svc = serviceClient();
  if (!verdict.ok) {
    await svc.rpc("svc_security_event", {
      p_user: null, p_event_type: "provider.bad_signature", p_severity: "critical",
      p_details: { provider: providerId, reason: verdict.reason },
    });
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const b = JSON.parse(raw);
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
