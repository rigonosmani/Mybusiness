"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BadgeCheck, Coins, Gamepad2, Plug, Receipt, Scale, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AmountDialog } from "@/components/admin/dialogs";
import dynamic from "next/dynamic";
import { PeriodSelect, periodArgs } from "@/components/admin/period";

const DailyChart = dynamic(() => import("@/components/admin/charts").then((m) => m.DailyChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-md bg-panel-2" /> });
import { AuditTable } from "@/components/admin/audit-table";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { houseResult, type SuperOverview } from "@/lib/reports";
import { formatDateTime, newKey } from "@/lib/utils";

export default function SuperDashboard() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [issueOpen, setIssueOpen] = useState(false);
  const q = useQuery({ queryKey: ["super-overview", days], queryFn: () => rpc<SuperOverview>("super_admin_overview", periodArgs(days)) });
  const issue = useAction((u: bigint, note: string) => rpc("issue_credits", { p_amount: u.toString(), p_reason: note || "Demo credit issuance", p_idempotency_key: newKey() }),
    { success: t.profile.saved, onSuccess: () => { setIssueOpen(false); qc.invalidateQueries(); } });
  const reconcile = useAction(() => rpc<{ ok: boolean; account_mismatches: number; unbalanced_transactions: number }>("reconcile_ledger"), {
    onSuccess: (r) => (r.ok ? toast.success(t.super.reconcileOk) : toast.error(`${t.super.reconcileBad} (${r.account_mismatches}/${r.unbalanced_transactions})`)),
  });

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, t)} onRetry={() => q.refetch()} retryLabel={t.common.retry} />;
  const o = q.data;
  const hr = houseResult(o.wagering);
  return (
    <div className="space-y-6">
      <PageHeader title={t.super.dashboard} actions={<>
        <PeriodSelect days={days} onChange={setDays} />
        <Button variant="secondary" onClick={() => reconcile.run()} loading={reconcile.pending}><Scale /> {t.super.reconcile}</Button>
        <Button onClick={() => setIssueOpen(true)}><Coins /> {t.super.issue}</Button>
      </>} />
      <Notice>{t.super.noPlayerAccess}</Notice>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Wallet />} label={t.super.myBalance} value={formatCredits(o.credits.my_balance)} sub={`${t.super.issuedTotal}: ${formatCredits(o.credits.issued_total)}`} tone="accent" />
        <Stat icon={<Users />} label={t.super.totalAdmins} value={o.admins.total} sub={`${t.super.activeAdmins}: ${o.admins.active} · ${t.super.suspendedAdmins}: ${o.admins.suspended}`} />
        <Stat icon={<Coins />} label={t.super.allocatedTotal} value={formatCredits(o.credits.allocated_total - o.credits.reclaimed_total)} sub={`${t.super.transferredPeriod}: ${formatCredits(o.credits.allocated_period)}`} />
        <Stat icon={<Wallet />} label={t.super.adminAvailable} value={formatCredits(o.credits.admin_available)} sub={`${t.admin.playerBalances}: ${formatCredits(o.credits.player_held)} · ${o.players_total} ${t.super.playersCount}`} />
        <Stat icon={<Receipt />} label={t.super.sportsStaked} value={formatCredits(o.wagering.sports_staked)} sub={`${t.common.payout}: ${formatCredits(o.wagering.sports_returned)}`} />
        <Stat icon={<Gamepad2 />} label={t.super.casinoStaked} value={formatCredits(o.wagering.casino_staked)} sub={`${t.common.payout}: ${formatCredits(o.wagering.casino_returned)}`} />
        <Stat icon={<Scale />} label={t.super.houseResult} value={formatCredits(hr)} tone={hr >= 0 ? "good" : "bad"} />
        <Stat icon={<Receipt />} label={t.super.exposure} value={formatCredits(o.sportsbook.open_exposure)} sub={`${t.admin.openBets}: ${o.sportsbook.open_bets} · ${t.common.stake}: ${formatCredits(o.sportsbook.open_stake)}`} />
      </div>
      <Card><CardHeader title={t.super.wagering} /><DailyChart data={o.daily} /></Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t.admin.gameActivity} description={`${t.super.gameAvailability}: ${o.games_availability.enabled} ${t.common.enabled.toLowerCase()} · ${o.games_availability.disabled} ${t.common.disabled.toLowerCase()}`} />
          <Table>
            <THead><tr><TH>{t.common.game}</TH><TH className="text-right">#</TH><TH className="text-right">{t.common.stake}</TH><TH className="text-right">{t.common.payout}</TH><TH className="text-right">{t.casino.rtp}</TH></tr></THead>
            <TBody>
              {o.games.length === 0 && <tr><TD colSpan={5} className="text-center text-muted-foreground">{t.common.empty}</TD></tr>}
              {o.games.map((g) => (
                <TR key={g.game_id}><TD>{g.game_id}</TD><TD className="text-right">{g.rounds}</TD><TD className="text-right tabular-nums">{formatCredits(g.staked)}</TD>
                  <TD className="text-right tabular-nums">{formatCredits(g.paid)}</TD><TD className="text-right tabular-nums">{g.realized_rtp !== null ? (g.realized_rtp * 100).toFixed(2) + "%" : "—"}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t.super.perAdmin} />
          <Table>
            <THead><tr><TH>{t.common.username}</TH><TH className="text-right">{t.super.playersCount}</TH><TH className="text-right">{t.admin.wagered}</TH></tr></THead>
            <TBody>
              {o.per_admin.map((a) => <TR key={a.admin_id}><TD>@{a.username}</TD><TD className="text-right">{a.players}</TD><TD className="text-right tabular-nums">{formatCredits(a.wagered)}</TD></TR>)}
            </TBody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Plug className="size-4" /> {t.super.apiStatus}</span>} />
        <div className="grid gap-3 md:grid-cols-2">
          {o.integrations.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-md border border-border bg-panel-2 p-3 text-sm">
              <div><p className="font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{t.super.integrations.lastSuccess}: {i.last_success_at ? formatDateTime(i.last_success_at, locale) : t.common.never}{i.requests_remaining !== null ? ` · ${t.super.integrations.remaining}: ${i.requests_remaining}` : ""}</p></div>
              <StatusBadge status={i.enabled ? i.status : "disabled"} />
            </div>
          ))}
        </div>
      </Card>
      <Card><CardHeader title={<span className="flex items-center gap-2"><BadgeCheck className="size-4" /> {t.super.activity}</span>} /><AuditTable limit={15} /></Card>
      <AmountDialog open={issueOpen} onOpenChange={setIssueOpen} title={t.super.issue} description={t.super.issueHint} confirmLabel={t.super.issue} pending={issue.pending} onSubmit={(u, n) => issue.run(u, n)} />
    </div>
  );
}
