/**
 * admin-users — account administration that needs the Supabase Admin API.
 *
 * POST { action: "create_admin" | "create_player", username, display_name, password }
 * POST { action: "reset_password", user_id, password }
 * POST { action: "set_status", user_id, status: "active" | "suspended" | "deactivated" }
 *
 * The caller's JWT is verified with Supabase Auth. Authorization is decided in
 * the database (svc_* functions / RPCs) — this function only performs the auth
 * side effects once the database has approved them.
 */
import { corsHeaders, errorCode, json, statusFor } from "../_shared/http.ts";
import { requireCaller, serviceClient, userClient } from "../_shared/supabase.ts";
import { usernameToEmail, validatePassword } from "../_shared/passwords.ts";

const EMAIL_DOMAIN = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "accounts.kometa.local";

async function rpc(client: ReturnType<typeof serviceClient>, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "METHOD_NOT_ALLOWED" });

  const svc = serviceClient();
  let callerId: string | null = null;
  try {
    const caller = await requireCaller(req);
    callerId = caller.id;
    await rpc(svc, "svc_rate_limit", { p_bucket: `admin-users:${caller.id}`, p_limit: 30, p_window_seconds: 60 });
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "create_admin":
      case "create_player": {
        const role = body.action === "create_admin" ? "admin" : "player";
        const username = String(body.username ?? "").trim().toLowerCase();
        const pwErr = validatePassword(body.password);
        if (pwErr) return json(req, 400, { error: pwErr });
        // Authorize before creating anything in Auth.
        await rpc(svc, "svc_check_can_provision", { p_actor: caller.id, p_actor_aal: caller.aal, p_role: role, p_username: username });
        const { data: created, error } = await svc.auth.admin.createUser({
          email: usernameToEmail(username, EMAIL_DOMAIN),
          password: body.password,
          email_confirm: true,
          user_metadata: { username },
        });
        if (error || !created.user) return json(req, 400, { error: "AUTH_CREATE_FAILED", detail: error?.message });
        try {
          const result = await rpc(svc, "svc_provision_account", {
            p_actor: caller.id, p_actor_aal: caller.aal, p_user_id: created.user.id, p_role: role,
            p_username: username, p_display_name: body.display_name ?? username,
          });
          return json(req, 200, result);
        } catch (e) {
          // Compensate: never leave an auth user without a profile.
          await svc.auth.admin.deleteUser(created.user.id);
          throw e;
        }
      }

      case "reset_password": {
        const pwErr = validatePassword(body.password);
        if (pwErr) return json(req, 400, { error: pwErr });
        await rpc(svc, "svc_authorize_manage", {
          p_actor: caller.id, p_actor_aal: caller.aal, p_target: body.user_id, p_permission: "players.reset_password",
        });
        const { error } = await svc.auth.admin.updateUserById(body.user_id, { password: body.password });
        if (error) return json(req, 400, { error: "AUTH_UPDATE_FAILED" });
        await rpc(svc, "svc_record_password_reset", { p_actor: caller.id, p_target: body.user_id });
        return json(req, 200, { ok: true });
      }

      case "set_status": {
        // The status change itself runs as the caller, so RLS/MFA/permissions apply.
        const asCaller = userClient(caller.jwt);
        const { error } = await asCaller.rpc("set_account_status", { p_user_id: body.user_id, p_status: body.status });
        if (error) throw new Error(error.message);
        // Block sign-in for suspended/deactivated accounts; existing access tokens expire within the JWT lifetime
        // and every RPC re-checks the account status in the database.
        const ban = body.status === "active" ? "none" : "876000h";
        await svc.auth.admin.updateUserById(body.user_id, { ban_duration: ban });
        return json(req, 200, { ok: true });
      }

      default:
        return json(req, 400, { error: "UNKNOWN_ACTION" });
    }
  } catch (e) {
    const code = errorCode(e);
    if (["FORBIDDEN", "PERMISSION_DENIED", "TARGET_NOT_FOUND"].includes(code) && callerId) {
      await svc.rpc("svc_security_event", {
        p_user: callerId, p_event_type: "admin_users.denied", p_severity: "warning", p_details: { code },
      });
    }
    return json(req, statusFor(code), { error: code });
  }
});
