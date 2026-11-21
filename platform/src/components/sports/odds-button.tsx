"use client";
import { Lock } from "lucide-react";
import { useBetSlip } from "@/stores/betslip";
import { cn } from "@/lib/utils";
import type { Fixture, Market, Outcome } from "@/lib/sports";

export function OddsButton({ fixture, market, outcome, label, disabled }: {
  fixture: Fixture; market: Market; outcome: Outcome; label: string; disabled?: boolean;
}) {
  const toggle = useBetSlip((s) => s.toggle);
  const selected = useBetSlip((s) => s.selections.some((x) => x.outcomeId === outcome.id));
  const locked = disabled || outcome.status !== "open" || market.status !== "open";
  const odds = Number(outcome.offered_odds).toFixed(2);
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={selected}
      onClick={() => toggle({
        outcomeId: outcome.id, fixtureId: fixture.id, eventName: `${fixture.home_team} – ${fixture.away_team}`,
        marketKey: market.market_key, label: outcome.label, odds, live: fixture.status === "live",
      })}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-panel-2 hover:border-primary/60",
        locked && "cursor-not-allowed opacity-50",
      )}
    >
      <span className={cn("truncate text-xs", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{label}</span>
      <span className="font-bold tabular-nums">{locked ? <Lock className="size-3.5" /> : odds}</span>
    </button>
  );
}
