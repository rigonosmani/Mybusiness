"use client";

/**
 * A "Loading chunk … failed" error happens when the browser has a page from an
 * older deployment, or a file download times out on a slow connection. A single
 * full reload fixes it, so do that automatically (at most once per 30 seconds).
 */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return e?.name === "ChunkLoadError" || /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(e?.message ?? "");
}

export function reloadOnceForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem("kometa-chunk-reload") ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem("kometa-chunk-reload", String(Date.now()));
  } catch {
    // storage blocked: still try one reload
  }
  window.location.reload();
  return true;
}
