"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { fetchGames } from "@/lib/casino";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";

const pctToBps = (s: string) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export default function HouseEdgePage() {
  const { t, locale } = useI18n();
  const h = t.super.houseEdge;
  const qc = useQueryClient();
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames });
  const history = useQuery({ queryKey: ["edge-history"], queryFn: async () => {
    const { data } = await supabaseBrowser().from("house_edge_history").select("*").order("id", { ascending: false }).limit(30);
    return (data ?? []) as { id: number; game_id: string; old_bps: number | null; new_bps: number; changed_at: string }[];
  } });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [global, setGlobal] = useState("1.00");
  const refresh = () => { setDrafts({}); qc.invalidateQueries({ queryKey: ["games"] }); qc.invalidateQueries({ queryKey: ["edge-history"] }); };
  const setEdge = useAction((id: string, bps: number) => rpc("admin_set_house_edge", { p_game_id: id, p_edge_bps: bps }), { success: h.saved, onSuccess: refresh });
  const setAll = useAction((bps: number) => rpc("admin_set_global_house_edge", { p_edge_bps: bps }), { success: h.saved, onSuccess: refresh });

  return (
    <div className="space-y-6">
      <PageHeader title={<span className="flex items-center gap-2"><Percent className="text-primary" /> {h.title}</span>} />
      <Card className="space-y-2 text-sm text-muted-foreground">
        <p>{h.explainEdge}</p><p>{h.explainRtp}</p><p>{h.explainMargin}</p><p>{h.explainRealized}</p><p>{h.explainProviders}</p>
      </Card>
      <Card>
        <CardHeader title={h.global} />
        <div className="flex max-w-sm gap-2">
          <Input value={global} onChange={(e) => setGlobal(e.target.value)} inputMode="decimal" aria-label={h.global} />
          <span className="self-center">%</span>
          <Button onClick={() => setAll.run(pctToBps(global))} loading={setAll.pending} disabled={!Number.isFinite(pctToBps(global))}>{t.common.save}</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={h.perGame} />
        {games.isLoading ? <SkeletonRows /> : (
          <Table>
            <THead><tr><TH>{t.common.game}</TH><TH>{t.casino.edge}</TH><TH>{t.casino.rtp}</TH><TH>{h.range}</TH><TH /></tr></THead>
            <TBody>
              {games.data?.map((g) => {
                const e = g.house_edge_settings;
                const draft = drafts[g.id] ?? (e ? (e.edge_bps / 100).toFixed(2) : "");
                return (
                  <TR key={g.id}>
                    <TD className="font-medium">{g.name}</TD>
                    <TD>{e ? (
                      <div className="flex w-32 items-center gap-1"><Input className="h-8" value={draft} inputMode="decimal" onChange={(ev) => setDrafts((d) => ({ ...d, [g.id]: ev.target.value }))} /><span>%</span></div>
                    ) : <span className="text-xs text-muted-foreground">{g.fixed_edge_note ?? h.fixedNote}</span>}</TD>
                    <TD className="tabular-nums">{e ? `${(100 - e.edge_bps / 100).toFixed(2)}%` : "—"}</TD>
                    <TD className="text-xs text-muted-foreground">{e ? `${(e.min_bps / 100).toFixed(2)}% – ${(e.max_bps / 100).toFixed(2)}%` : h.fixedNote}</TD>
                    <TD className="text-right">{e && <Button size="sm" variant="secondary" disabled={drafts[g.id] === undefined} loading={setEdge.pending}
                      onClick={() => setEdge.run(g.id, pctToBps(draft))}>{t.common.save}</Button>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t.super.security.audit} />
        <Table>
          <THead><tr><TH>{t.common.time}</TH><TH>{t.common.game}</TH><TH className="text-right">{t.common.from}</TH><TH className="text-right">{t.common.to}</TH></tr></THead>
          <TBody>{history.data?.map((r) => <TR key={r.id}><TD className="text-muted-foreground">{formatDateTime(r.changed_at, locale)}</TD><TD>{r.game_id}</TD>
            <TD className="text-right">{r.old_bps !== null ? (r.old_bps / 100).toFixed(2) + "%" : "—"}</TD><TD className="text-right">{(r.new_bps / 100).toFixed(2)}%</TD></TR>)}</TBody>
        </Table>
      </Card>
    </div>
  );
}
