"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import type { CasinoGame } from "@/lib/casino";
import { edge } from "@/lib/rpc";

/** Licensed provider game: launched server-side, played in an iframe, wallet = Kometa credits via callbacks. */
export function ExternalGame({ game }: { game: CasinoGame }) {
  const { t } = useI18n();
  const p = useProfile();
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    edge<{ url: string }>("casino-launch", { game_id: game.id })
      .then((r) => { if (!cancelled) setUrl(r.url); })
      .catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [game.id]);

  // The provider moves credits through our wallet callbacks; refresh the header balance while playing.
  useEffect(() => {
    if (!url) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ["balance", p.id] }), 4000);
    return () => clearInterval(id);
  }, [url, qc, p.id]);

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/casino" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t.common.back}</Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{game.name}</h1>
          <Badge>{game.casino_providers?.name}</Badge>
          {game.certified_rtp && <Badge>{t.casino.rtp} {game.certified_rtp}%</Badge>}
        </div>
        {url && (
          <button className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => document.getElementById("provider-frame")?.requestFullscreen?.()}><Maximize2 className="size-4" /></button>
        )}
      </div>
      {error ? <ErrorState message={errorMessage(error, t)} /> : !url ? <Skeleton className="aspect-video w-full" /> : (
        <iframe id="provider-frame" src={url} title={game.name} allow="fullscreen; autoplay"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          className="aspect-video w-full rounded-lg border border-border bg-black" />
      )}
    </div>
  );
}
