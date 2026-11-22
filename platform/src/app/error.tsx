"use client";
import { Button } from "@/components/ui/button";

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">Diçka shkoi keq · Something went wrong</p>
      <p className="max-w-md break-words text-sm text-muted-foreground">
        {error.message || "Unknown error"}{error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <Button onClick={reset}>Provo përsëri · Retry</Button>
    </main>
  );
}
