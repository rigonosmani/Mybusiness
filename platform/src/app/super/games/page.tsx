"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, PageHeader } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { fetchGames } from "@/lib/casino";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProviderConfig, type ProviderRow } from "@/components/admin/provider-config";

export default function GamesAdmin() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames });
  const providers = useQuery({ queryKey: ["providers"], queryFn: async () => (await supabaseBrowser().from("casino_providers").select("*").order("id")).data ?? [] });
  const toggle = useAction((id: string, v: boolean) => rpc("admin_set_game_enabled", { p_game_id: id, p_enabled: v }), { onSuccess: () => qc.invalidateQueries({ queryKey: ["games"] }) });
  return (
    <div className="space-y-6">
      <PageHeader title={t.super.games.title} />
      <h2 className="text-lg font-semibold">{t.super.games.providers}</h2>
      {(providers.data as ProviderRow[] | undefined)?.filter((p) => p.kind !== "in_house").map((p) => <ProviderConfig key={p.id} provider={p} />)}
      <Card>
        <Table>
          <THead><tr><TH>{t.casino.provider}</TH><TH>{t.common.status}</TH><TH>Wallet</TH><TH>{t.common.note}</TH></tr></THead>
          <TBody>{providers.data?.map((p: { id: string; name: string; status: string; wallet_mode: string; notes: string }) => (
            <TR key={p.id}><TD className="font-medium">{p.name}</TD><TD><StatusBadge status={p.status === "active" ? "active" : p.status} /></TD><TD className="font-mono text-xs">{p.wallet_mode}</TD><TD className="text-xs text-muted-foreground">{p.notes}</TD></TR>
          ))}</TBody>
        </Table>
      </Card>
      <Card>
        {games.isLoading ? <SkeletonRows /> : (
          <Table>
            <THead><tr><TH>{t.common.game}</TH><TH>{t.common.type}</TH><TH>{t.casino.edge}</TH><TH className="text-right">{t.super.games.toggle}</TH></tr></THead>
            <TBody>
              {games.data?.map((g) => (
                <TR key={g.id}>
                  <TD className="font-medium">{g.name}<p className="font-mono text-xs text-muted-foreground">{g.id}</p></TD>
                  <TD>{t.casino.categories[g.category] ?? g.category}</TD>
                  <TD className="text-xs">{g.house_edge_settings ? `${(g.house_edge_settings.edge_bps / 100).toFixed(2)}%` : g.certified_rtp ? `RTP ${g.certified_rtp}%` : g.fixed_edge_note}</TD>
                  <TD className="text-right"><Switch label={g.name} checked={g.enabled} onCheckedChange={(v) => toggle.run(g.id, v)} disabled={toggle.pending} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
