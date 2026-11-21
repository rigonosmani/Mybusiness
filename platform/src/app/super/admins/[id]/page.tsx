"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/switch";
import { LedgerTable } from "@/components/wallet/ledger-table";
import { ReverseButton } from "@/components/admin/reverse-button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

interface AdminRow { id: string; username: string; display_name: string; status: string; balance: number; created_at: string; last_login_at: string | null; player_count: number; permissions: Record<string, boolean> }
const PERMS = ["players.create", "players.update", "players.reset_password", "players.suspend", "credits.transfer", "credits.reclaim", "reports.view"];

export default function AdminDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admins"], queryFn: () => rpc<AdminRow[]>("list_admins") });
  const a = q.data?.find((x) => x.id === id);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  useEffect(() => { if (a) setPerms(a.permissions); }, [a]);
  const save = useAction(() => rpc("set_admin_permissions", { p_admin_id: id, p_permissions: perms }), { success: t.profile.saved, onSuccess: () => qc.invalidateQueries({ queryKey: ["admins"] }) });

  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (!a) return <ErrorState message={t.errors.ADMIN_NOT_FOUND} />;
  return (
    <div className="space-y-6">
      <Link href="/super/admins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t.common.back}</Link>
      <PageHeader title={a.display_name} description={`@${a.username} · ${t.common.created} ${formatDateTime(a.created_at, locale)}`}
        actions={<StatusBadge status={a.status} labels={{ active: t.common.active, suspended: t.common.suspended, deactivated: t.common.deactivated }} />} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t.common.balance} value={formatCredits(a.balance)} tone="accent" />
        <Stat label={t.super.playersCount} value={a.player_count} />
        <Stat label={t.common.lastLogin} value={a.last_login_at ? formatDateTime(a.last_login_at, locale) : t.common.never} />
      </div>
      <Card>
        <CardHeader title={t.super.permissions} action={<Button size="sm" onClick={() => save.run()} loading={save.pending}>{t.common.save}</Button>} />
        <div className="grid gap-3 sm:grid-cols-2">
          {PERMS.map((p) => (
            <label key={p} className="flex items-center justify-between rounded-md border border-border bg-panel-2 px-3 py-2 text-sm">
              <span className="font-mono text-xs">{p}</span>
              <Switch label={p} checked={!!perms[p]} onCheckedChange={(v) => setPerms((x) => ({ ...x, [p]: v }))} />
            </label>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title={t.super.viewLedger} />
        <LedgerTable userId={id} renderAction={(tx) => <ReverseButton txId={tx.id} txType={tx.tx_type} types={["allocation", "reclaim"]} />} />
      </Card>
    </div>
  );
}
