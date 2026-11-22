import { LogoMark } from "@/components/brand";

/** Shown by Next.js while a route segment loads (instead of a blank screen). */
export function PageLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <LogoMark className="size-12 animate-pulse" />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-panel-3">
        <div className="h-full w-1/3 animate-[loadbar_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
