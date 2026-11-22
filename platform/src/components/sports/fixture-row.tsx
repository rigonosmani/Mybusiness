"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isFresh, liveClock, outcomeOrder, type Fixture } from "@/lib/sports";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { OddsButton } from "./odds-button";

export function FixtureRow({ fixture, freshness }: { fixture: Fixture; freshness: { prematch: number; live: number; liveEnabled: boolean } }) {
  const { t, locale } = useI18n();
  const main = fixture.betting_markets.find((m) => m.market_key === "h2h" || m.market_key === "h2h_3way");
  const fresh = main ? isFresh(main, fixture, freshness) : false;
  const liveBlocked = fixture.status === "live" && !freshness.liveEnabled;
  const more = fixture.betting_markets.filter((m) => m.status === "open").length - (main ? 1 : 0);
  const outcomes = main ? [...main.market_outcomes].sort((a, b) => outcomeOrder.indexOf(a.outcome_key) - outcomeOrder.indexOf(b.outcome_key)) : [];
  const short = (k: string, label: string) => (k === "home" ? "1" : k === "away" ? "2" : k === "draw" ? "X" : label);
  const isLive = fixture.status === "live";
  const clock = isLive ? liveClock(fixture) : null;
  // In-play without fresh odds: show a score card only (no locked buttons, no stale badge).
  const scoreOnly = isLive && (!main || !fresh || liveBlocked);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3 sm:flex-row sm:items-center">
      <Link href={`/sports/event/${fixture.id}`} className="min-w-0 flex-1 group">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          {fixture.status === "live" ? <Badge tone="danger">{t.sports.liveBadge}</Badge> : <span>{formatDateTime(fixture.commence_time, locale)}</span>}
          {isLive && clock && <span className="font-semibold tabular-nums text-accent">{clock === "HT" ? t.sports.halfTime : clock}</span>}
          <span className="truncate">{fixture.leagues.name}</span>
          {main && !fresh && !isLive && <Badge tone="warning">{t.sports.stale}</Badge>}
        </div>
        <div className="flex items-center justify-between gap-2 font-medium">
          <div className="min-w-0">
            <p className="truncate">{fixture.home_team}</p>
            <p className="truncate">{fixture.away_team}</p>
          </div>
          {isLive && (
            <div className="text-right text-lg font-extrabold tabular-nums text-accent"><p>{fixture.home_score ?? "–"}</p><p>{fixture.away_score ?? "–"}</p></div>
          )}
        </div>
      </Link>
      {scoreOnly ? null : <div className="flex items-center gap-2 sm:w-[22rem]">
        {main ? outcomes.map((o) => (
          <OddsButton key={o.id} fixture={fixture} market={main} outcome={o} label={short(o.outcome_key, o.label)} disabled={!fresh || liveBlocked} />
        )) : <span className="flex-1 text-center text-xs text-muted-foreground">{t.sports.suspended}</span>}
        <Link href={`/sports/event/${fixture.id}`} className="flex items-center rounded-md px-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-label={t.sports.allMarkets}>
          {more > 0 ? `+${more}` : ""}<ChevronRight className="size-4" />
        </Link>
      </div>}
    </div>
  );
}
