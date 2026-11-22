"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { SecretField, type SecretStatus } from "./secret-field";

export interface ProviderRow { id: string; name: string; kind: string; status: string; api_base_url: string | null; license_reference: string | null; config: Record<string, unknown>; notes: string | null }

export function ProviderConfig({ provider }: { provider: ProviderRow }) {
  const { t } = useI18n();
  const g = t.super.games;
  const qc = useQueryClient();
  const secrets = useQuery({ queryKey: ["secret-status"], queryFn: () => rpc<SecretStatus[]>("integration_secret_status") });
  const [status, setStatus] = useState(provider.status);
  const [url, setUrl] = useState(provider.api_base_url ?? "");
  const [lic, setLic] = useState(provider.license_reference ?? "");
  const [config, setConfig] = useState(JSON.stringify(provider.config ?? {}, null, 2));
  const [games, setGames] = useState("");
  useEffect(() => { setStatus(provider.status); }, [provider.status]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["providers"] }); qc.invalidateQueries({ queryKey: ["games"] }); };
  const save = useAction(() => {
    let cfg: unknown;
    try { cfg = JSON.parse(config || "{}"); } catch { throw new Error("INVALID_PARAMS"); }
    return rpc("admin_update_provider", { p_id: provider.id, p_status: status, p_api_base_url: url.trim() || null, p_license_reference: lic.trim() || null, p_config: cfg });
  }, { success: t.profile.saved, onSuccess: refresh });
  const importGames = useAction(() => {
    let list: unknown;
    try { list = JSON.parse(games); } catch { throw new Error("INVALID_PARAMS"); }
    return rpc<{ imported: number }>("admin_import_games", { p_provider: provider.id, p_games: list });
  }, { onSuccess: (r) => { toast.success(`${g.imported}: ${r.imported}`); setGames(""); refresh(); } });
  const callbackUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/casino-provider-callback`;
  const s = (name: string) => secrets.data?.find((x) => x.integration_id === provider.id && x.name === name);

  return (
    <Card className="space-y-4">
      <CardHeader title={provider.name} description={provider.notes ?? undefined} action={<StatusBadge status={provider.status === "active" ? "active" : provider.status} />} />
      <Notice tone="warning">{g.contractNote}</Notice>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={g.status}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="not_configured">not_configured</option><option value="disabled">disabled</option><option value="active">active</option>
          </Select>
        </Field>
        <Field label={g.baseUrl}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.provider.com" /></Field>
        <Field label={g.license}><Input value={lic} onChange={(e) => setLic(e.target.value)} /></Field>
      </div>
      <Field label={g.providerConfig}><Textarea rows={5} value={config} onChange={(e) => setConfig(e.target.value)} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <SecretField integration={provider.id} name="api_key" label={t.super.integrations.apiKey} status={s("api_key")} />
        <SecretField integration={provider.id} name="callback_secret" label={g.callbackSecret} status={s("callback_secret")} />
      </div>
      <Field label={g.callbackUrl}>
        <div className="flex gap-2">
          <Input readOnly value={callbackUrl} className="font-mono text-xs" />
          <Button type="button" variant="secondary" className="h-10" onClick={() => { navigator.clipboard.writeText(callbackUrl); toast.success(t.common.copied); }} aria-label={t.common.copy}><Copy /></Button>
        </div>
      </Field>
      <Button onClick={() => save.run()} loading={save.pending}>{t.common.save}</Button>
      <div className="border-t border-border pt-4">
        <Field label={g.importGames}><Textarea rows={5} value={games} placeholder={g.importHint} onChange={(e) => setGames(e.target.value)} /></Field>
        <Button className="mt-2" variant="secondary" onClick={() => importGames.run()} loading={importGames.pending} disabled={!games.trim()}>{g.import}</Button>
      </div>
    </Card>
  );
}
