"use client";
import type { UseQueryResult } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits } from "@/lib/money";
import type { BetRow } from "@/lib/bets";
import { formatDateTime } from "@/lib/utils";

export function BetList({ query }: { query: UseQueryResult<BetRow[]> }) {
  const { t, locale } = useI18n();
  if (query.isLoading) return <SkeletonRows rows={4} />;
  if (query.error) return <ErrorState message={errorMessage(query.error, t)} onRetry={() => query.refetch()} retryLabel={t.common.retry} />;
  if (!query.data?.length) return <EmptyState title={t.bets.none} icon={<Receipt />} />;
  return (
    <div className="space-y-3">
      {query.data.map((b) => (
        <Card key={b.id} className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{b.bet_type === "single" ? t.bets.single : `${t.bets.accumulator} (${b.bet_selections.length})`}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(b.placed_at, locale)}</span>
            </div>
            <StatusBadge status={b.status} labels={t.bets.status} />
          </div>
          <ul className="mb-3 space-y-1.5">
            {b.bet_selections.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{s.outcome_label} <span className="text-muted-foreground">· {(t.sports.markets as Record<string, string>)[s.market_key] ?? s.market_key}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{s.event_name}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{Number(s.odds).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">{t.bets.result[s.result] ?? s.result}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm">
            <div><p className="text-xs text-muted-foreground">{t.common.stake}</p><p className="font-semibold tabular-nums">{formatCredits(b.stake)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t.bets.odds}</p><p className="font-semibold tabular-nums">{Number(b.total_odds).toFixed(2)}</p></div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{b.status === "open" ? t.bets.potential : t.common.payout}</p>
              <p className={b.status === "won" ? "font-bold text-success tabular-nums" : "font-semibold tabular-nums"}>
                {formatCredits(b.status === "open" ? b.potential_payout : b.payout ?? 0)}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
