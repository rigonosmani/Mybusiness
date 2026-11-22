"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Notice, SkeletonRows } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { SecretField, type SecretStatus } from "@/components/admin/secret-field";
import { edge } from "@/lib/rpc";

interface Integration { id: string; name: string; enabled: boolean; key_configured: boolean; status: string; config: Record<string, unknown>; requests_remaining: number | null; last_success_at: string | null; last_error: string | null }
interface SyncLog { id: number; integration_id: string; job: string; status: string; items: number; requests_remaining: number | null; error: string | null; details: Record<string, unknown>; started_at: string }

export default function IntegrationsPage() {
  const { t, locale } = useI18n();
  const it = t.super.integrations;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["integrations"], queryFn: async () => (await supabaseBrowser().from("api_integrations").select("*").order("id")).data as Integration[] });
  const logs = useQuery({ queryKey: ["sync-logs"], queryFn: async () => (await supabaseBrowser().from("provider_sync_logs").select("*").order("id", { ascending: false }).limit(50)).data as SyncLog[] });
  const secrets = useQuery({ queryKey: ["secret-status"], queryFn: () => rpc<SecretStatus[]>("integration_secret_status") });
  const sync = useAction(() => edge<{ status: string; leagues_synced?: string[]; errors?: string[] }>("admin-integrations", { action: "sync_odds" }), {
    onSuccess: (r) => { toast[r.status === "error" ? "error" : "success"](`${it.syncDone}: ${r.status}${r.errors?.length ? ` · ${r.errors[0]}` : ""}`); qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["sync-logs"] }); },
  });
  const live = useAction(() => edge<{ status: string; polled?: boolean; targets?: number; matched?: number; priced?: number; errors?: string[]; reason?: string }>("admin-integrations", { action: "sync_live" }), {
    onSuccess: (r) => {
      const msg = r.status === "idle" ? `${it.syncDone}: 0 live` : r.reason ?? `${it.syncDone}: ${r.status} · live ${r.targets ?? 0} · matched ${r.matched ?? 0} · priced ${r.priced ?? 0}`;
      toast[r.status === "error" ? "error" : "success"](`${msg}${r.errors?.length ? ` · ${r.errors[0]}` : ""}`);
      qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const update = useAction((id: string, enabled: boolean | null, config: unknown) => rpc("admin_update_integration", { p_id: id, p_enabled: enabled, p_config: config }), {
    success: t.profile.saved, onSuccess: () => { setDrafts({}); qc.invalidateQueries({ queryKey: ["integrations"] }); },
  });
  return (
    <div className="space-y-6">
      <PageHeader title={it.title} />
      <Notice>{it.panelKeyHint}</Notice>
      {q.isLoading && <SkeletonRows />}
      {q.data?.map((i) => (
        <Card key={i.id}>
          <CardHeader title={i.name} description={`${it.keyConfigured}: ${i.key_configured ? t.common.yes : t.common.no} · ${it.lastSuccess}: ${i.last_success_at ? formatDateTime(i.last_success_at, locale) : t.common.never}${i.requests_remaining !== null ? ` · ${it.remaining}: ${i.requests_remaining}` : ""}`}
            action={<div className="flex items-center gap-3"><StatusBadge status={i.enabled ? i.status : "disabled"} /><Switch label={i.name} checked={i.enabled} onCheckedChange={(v) => update.run(i.id, v, null)} /></div>} />
          {i.id === "live_engine" ? (
            <div className="mb-4 space-y-3">
              <p className="text-sm text-muted-foreground">{it.liveHint}</p>
              <Button variant="secondary" onClick={() => live.run()} loading={live.pending} disabled={!i.enabled}><RefreshCw /> {it.liveNow}</Button>
            </div>
          ) : (
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <SecretField integration={i.id} name="api_key" label={it.apiKey} status={secrets.data?.find((s) => s.integration_id === i.id && s.name === "api_key")} />
            {i.id === "the_odds_api" && <Button variant="secondary" onClick={() => sync.run()} loading={sync.pending} disabled={!i.enabled}><RefreshCw /> {it.syncNow}</Button>}
          </div>
          )}
          {i.last_error && <p className="mb-3 rounded bg-danger/10 p-2 font-mono text-xs text-danger">{i.last_error}</p>}
          <p className="mb-1 text-xs text-muted-foreground">{it.config}</p>
          <Textarea rows={6} value={drafts[i.id] ?? JSON.stringify(i.config, null, 2)} onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))} />
          <Button className="mt-2" size="sm" disabled={drafts[i.id] === undefined} loading={update.pending} onClick={() => {
            try { update.run(i.id, null, JSON.parse(drafts[i.id])); } catch { toast.error("JSON"); }
          }}>{t.common.save}</Button>
        </Card>
      ))}
      <Card>
        <CardHeader title={it.syncLogs} />
        <Table>
          <THead><tr><TH>{t.common.time}</TH><TH>API</TH><TH>Job</TH><TH>{t.common.status}</TH><TH className="text-right">#</TH><TH>{t.common.details}</TH></tr></THead>
          <TBody>
            {logs.data?.length === 0 && <tr><TD colSpan={6} className="text-center text-muted-foreground">{t.common.empty}</TD></tr>}
            {logs.data?.map((l) => (
              <TR key={l.id}><TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(l.started_at, locale)}</TD><TD>{l.integration_id}</TD><TD>{l.job}</TD>
                <TD><StatusBadge status={l.status === "ok" ? "ok" : l.status === "error" ? "error" : "void"} /></TD><TD className="text-right">{l.items}</TD>
                <TD className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={l.error ?? JSON.stringify(l.details)}>{l.error ?? JSON.stringify(l.details)}</TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
