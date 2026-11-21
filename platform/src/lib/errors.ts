import type { Dict } from "./i18n/en";

/** Extracts the stable application error code from a Supabase/PostgREST/Edge error. */
export function errorCodeOf(e: unknown): string {
  const anyE = e as { message?: string; error?: string; context?: unknown } | null;
  const raw = anyE?.error ?? anyE?.message ?? String(e ?? "");
  const m = /^[A-Z][A-Z0-9_]{2,}/.exec(raw);
  return m ? m[0] : "UNKNOWN";
}

export function errorMessage(e: unknown, t: Dict): string {
  const code = errorCodeOf(e);
  return (t.errors as Record<string, string>)[code] ?? t.errors.UNKNOWN;
}
