"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { OddsButton } from "@/components/sports/odds-button";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { fetchFixture, fetchFreshness, isFresh, outcomeOrder, liveClock } from "@/lib/sports";
import { formatDateTime } from "@/lib/utils";

export default function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const fx = useQuery({ queryKey: ["fixture", id], queryFn: () => fetchFixture(id), refetchInterval: 15_000 });
  const fr = useQuery({ queryKey: ["freshness"], queryFn: fetchFreshness, staleTime: 300_000 });

  if (fx.isLoading || fr.isLoading) return <Skeleton className="h-64 w-full" />;
  if (fx.error || !fx.data) return <ErrorState message={errorMessage(fx.error, t)} />;
  const f = fx.data;
  const markets = [...f.betting_markets].sort((a, b) =>
    Object.keys(t.sports.markets).indexOf(a.market_key) - Object.keys(t.sports.markets).indexOf(b.market_key) || (a.line ?? 0) - (b.line ?? 0));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/sports" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t.common.back}</Link>
      <Card className="card-shine mb-6 text-center">
        <p className="text-xs text-muted-foreground">{f.leagues.name}</p>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <p className="text-lg font-bold">{f.home_team}</p>
          <div>
            {f.status === "live" || f.status === "finished" ? (
              <p className="text-3xl font-extrabold tabular-nums text-accent">{f.home_score ?? 0} : {f.away_score ?? 0}</p>
            ) : <p className="text-sm text-muted-foreground">{formatDateTime(f.commence_time, locale)}</p>}
            {f.status === "live" && <Badge tone="danger" className="mt-1">{t.sports.liveBadge}</Badge>}
            {f.status === "live" && liveClock(f) && <p className="mt-1 text-sm font-semibold tabular-nums text-accent">{liveClock(f) === "HT" ? t.sports.halfTime : liveClock(f)}</p>}
            {f.status === "live" && f.live_suspended_until && Date.parse(f.live_suspended_until) > Date.now() && <p className="mt-1 text-xs text-warning">{t.sports.liveSuspended}</p>}
          </div>
          <p className="text-lg font-bold">{f.away_team}</p>
        </div>
      </Card>
      <div className="space-y-3">
        {markets.map((m) => {
          const fresh = isFresh(m, f, fr.data!);
          const blocked = f.status === "live" && !fr.data!.liveEnabled;
          return (
            <Card key={m.id} className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {(t.sports.markets as Record<string, string>)[m.market_key] ?? m.market_key}{m.line !== null && m.market_key === "totals" ? ` ${m.line}` : ""}
                </h3>
                <span className="text-xs text-muted-foreground">{m.bookmaker_count} {t.sports.bookmakers}{!fresh && m.status === "open" ? ` · ${t.sports.stale}` : ""}{m.status !== "open" ? ` · ${t.sports.suspended}` : ""}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[...m.market_outcomes].sort((a, b) => outcomeOrder.indexOf(a.outcome_key) - outcomeOrder.indexOf(b.outcome_key)).map((o) => (
                  <OddsButton key={o.id} fixture={f} market={m} outcome={o} disabled={!fresh || blocked}
                    label={o.outcome_key === "draw" ? t.sports.draw : o.label} />
                ))}
              </div>
            </Card>
          );
        })}
        {markets.length === 0 && <p className="text-center text-sm text-muted-foreground">{t.sports.noEvents}</p>}
      </div>
    </div>
  );
}
