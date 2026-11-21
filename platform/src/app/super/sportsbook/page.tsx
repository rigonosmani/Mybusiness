"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, CheckSquare, Pause, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, SkeletonRows } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/admin/dialogs";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import type { Fixture, Market } from "@/lib/sports";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";

const RESULTS = ["won", "lost", "void", "half_won", "half_lost"] as const;

export default function SportsbookOps() {
  const { t, locale } = useI18n();
  const o = t.super.ops;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "scheduled" | "finished">("live");
  const [settle, setSettle] = useState<Market | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ kind: "void"; market: Market } | { kind: "cancel"; fixture: Fixture } | null>(null);

  const q = useQuery({
    queryKey: ["ops-fixtures", tab],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().from("fixtures")
        .select("id, home_team, away_team, commence_time, status, home_score, away_score, last_odds_at, leagues!inner(id, name, sport_id), betting_markets(id, market_key, line, status, last_odds_at, bookmaker_count, market_outcomes(id, outcome_key, label, point, offered_odds, status, result))")
        .eq("status", tab).order("commence_time", { ascending: tab !== "finished" }).limit(50);
      if (error) throw error;
      return data as unknown as Fixture[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops-fixtures"] });
  const setStatus = useAction((id: string, s: string) => rpc("admin_set_market_status", { p_market_id: id, p_status: s }), { onSuccess: refresh });
  const voidMarket = useAction((id: string, reason: string) => rpc("admin_void_market", { p_market_id: id, p_reason: reason }), { success: t.profile.saved, onSuccess: () => { setConfirm(null); refresh(); } });
  const cancel = useAction((id: string, reason: string) => rpc("admin_cancel_fixture", { p_fixture_id: id, p_reason: reason }), { success: t.profile.saved, onSuccess: () => { setConfirm(null); refresh(); } });
  const manual = useAction((id: string, r: Record<string, string>) => rpc("admin_settle_market", { p_market_id: id, p_results: r }), { success: t.profile.saved, onSuccess: () => { setSettle(null); refresh(); } });

  return (
    <div className="space-y-6">
      <PageHeader title={o.title} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="live">{t.sports.live}</TabsTrigger>
          <TabsTrigger value="scheduled">{t.sports.upcoming}</TabsTrigger>
          <TabsTrigger value="finished">{t.bets.settled}</TabsTrigger>
        </TabsList>
      </Tabs>
      {q.isLoading ? <SkeletonRows /> : !q.data?.length ? <EmptyState title={t.sports.noEvents} /> : q.data.map((f) => (
        <Card key={f.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{f.home_team} – {f.away_team} {f.home_score !== null && <span className="text-accent">({f.home_score}:{f.away_score})</span>}</p>
              <p className="text-xs text-muted-foreground">{f.leagues.name} · {formatDateTime(f.commence_time, locale)}</p>
            </div>
            {f.status !== "finished" && <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: "cancel", fixture: f })}><XCircle /> {o.cancelFixture}</Button>}
          </div>
          <div className="space-y-2">
            {f.betting_markets.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md bg-panel-2 p-2 text-sm">
                <span className="min-w-[9rem] font-medium">{(t.sports.markets as Record<string, string>)[m.market_key] ?? m.market_key}{m.line !== null ? ` ${m.line}` : ""}</span>
                <StatusBadge status={m.status} />
                <div className="flex flex-1 flex-wrap gap-1">
                  {m.market_outcomes.map((x) => <Badge key={x.id} tone={x.result === "won" ? "success" : x.result === "lost" ? "danger" : "default"}>{x.label} {Number(x.offered_odds).toFixed(2)}{x.result !== "pending" ? ` · ${t.bets.result[x.result]}` : ""}</Badge>)}
                </div>
                {(m.status === "open" || m.status === "suspended") && (
                  <div className="flex gap-1">
                    {m.status === "open"
                      ? <Button size="sm" variant="ghost" onClick={() => setStatus.run(m.id, "suspended")}><Pause /> {o.suspend}</Button>
                      : <Button size="sm" variant="ghost" onClick={() => setStatus.run(m.id, "open")}><Play /> {o.reopen}</Button>}
                    <Button size="sm" variant="secondary" onClick={() => { setSettle(m); setResults(Object.fromEntries(m.market_outcomes.map((x) => [x.outcome_key, "lost"]))); }}><CheckSquare /> {o.settle}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "void", market: m })}><Ban /> {o.voidMarket}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Dialog open={!!settle} onOpenChange={(v) => !v && setSettle(null)} title={o.settle}>
        {settle && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); manual.run(settle.id, results); }}>
            {settle.market_outcomes.map((x) => (
              <Field key={x.id} label={x.label}>
                <Select value={results[x.outcome_key]} onChange={(e) => setResults((r) => ({ ...r, [x.outcome_key]: e.target.value }))}>
                  {RESULTS.map((r) => <option key={r} value={r}>{t.bets.result[r]}</option>)}
                </Select>
              </Field>
            ))}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSettle(null)}>{t.common.cancel}</Button><Button type="submit" loading={manual.pending}>{t.common.confirm}</Button></div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} danger withReason
        title={confirm?.kind === "cancel" ? o.cancelFixture : o.voidMarket} confirmLabel={t.common.confirm}
        pending={voidMarket.pending || cancel.pending}
        onConfirm={(reason) => confirm?.kind === "cancel" ? cancel.run(confirm.fixture.id, reason) : confirm && voidMarket.run(confirm.market.id, reason)} />
    </div>
  );
}
