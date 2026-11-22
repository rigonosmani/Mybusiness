/**
 * Generic seamless-wallet aggregator protocol.
 *
 * Most casino aggregators follow the same shape: the operator asks for a launch
 * URL (server-to-server, signed), the game runs in an iframe, and the aggregator
 * calls the operator's wallet for balance/debit/credit/rollback. Field names differ
 * per vendor, so everything that varies is configurable in the provider's config
 * (Main admin → Games → provider). If a vendor's API differs more than this allows,
 * add a small adapter next to this file.
 */
import { hmacHex } from "../signature.ts";

export interface ProviderConfig {
  operator_id?: string;
  launch_path?: string;        // default "/games/launch"
  launch_url_field?: string;   // default: first of url | game_url | launch_url | gameUrl
  currency?: string;           // default "CR"
  extra?: Record<string, unknown>;
}

export interface LaunchContext {
  session_id: string;
  user_id: string;
  username: string;
  locale: string;
  external_game_id: string;
  api_base_url: string;
  config: ProviderConfig;
}

export async function buildLaunchRequest(ctx: LaunchContext, token: string, apiKey: string, opts: { returnUrl: string; now?: number }) {
  const body = JSON.stringify({
    operator_id: ctx.config.operator_id ?? null,
    game_id: ctx.external_game_id,
    session_token: token,
    player_id: ctx.user_id,
    player_name: ctx.username,
    currency: ctx.config.currency ?? "CR",
    language: ctx.locale,
    return_url: opts.returnUrl,
    ...(ctx.config.extra ?? {}),
  });
  const ts = String(Math.floor((opts.now ?? Date.now()) / 1000));
  const url = new URL(ctx.config.launch_path ?? "/games/launch", ctx.api_base_url).toString();
  if (!url.startsWith("https://")) throw new Error("INVALID_URL");
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-operator-id": ctx.config.operator_id ?? "",
        "x-timestamp": ts,
        "x-signature": await hmacHex(apiKey, `${ts}.${body}`),
        authorization: `Bearer ${apiKey}`,
      },
      body,
    } satisfies RequestInit,
  };
}

export function parseLaunchResponse(json: unknown, field?: string): string {
  const o = (json ?? {}) as Record<string, unknown>;
  const pick = (k: string) => {
    let v: unknown = o;
    for (const part of k.split(".")) v = (v as Record<string, unknown> | undefined)?.[part];
    return typeof v === "string" ? v : undefined;
  };
  const url = field ? pick(field) : pick("url") ?? pick("game_url") ?? pick("launch_url") ?? pick("gameUrl") ?? pick("data.url");
  if (!url || !/^https:\/\//.test(url)) throw new Error("PROVIDER_BAD_RESPONSE");
  return url;
}
