"use client";
import { supabaseBrowser } from "./supabase/client";

/** Calls a Postgres RPC as the signed-in user. Throws an Error whose message starts with the app error code. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(fn, args ?? {});
  if (error) throw new Error(error.message || error.code || "UNKNOWN");
  return data as T;
}

/** Calls an Edge Function with the user's JWT. */
export async function edge<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError carries the JSON body in `context`.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json().catch(() => null);
      throw new Error(j?.error ?? "UNKNOWN");
    }
    throw new Error(error.message);
  }
  return data as T;
}
