/** HTTP helpers shared by Edge Functions. */
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  // Only echo explicitly allowed origins (no wildcard for authenticated APIs).
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) },
  });
}

/** Map a Postgres/PostgREST error to an application error code. */
export function errorCode(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  const m = msg.match(/^[A-Z][A-Z0-9_]{2,}/);
  return m ? m[0] : "INTERNAL_ERROR";
}

export function statusFor(code: string): number {
  if (["NOT_AUTHENTICATED"].includes(code)) return 401;
  if (["FORBIDDEN", "PERMISSION_DENIED", "MFA_REQUIRED", "ACCOUNT_NOT_ACTIVE"].includes(code)) return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "RATE_LIMITED") return 429;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}
