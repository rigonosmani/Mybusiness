"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Receipt, Users, Wallet, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DailyChart, PeriodSelect, periodArgs } from "@/components/admin/charts";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import type { AdminOverview } from "@/lib/reports";

export default function AdminDashboard() {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["admin-overview", days], queryFn: () => rpc<AdminOverview>("admin_overview", periodArgs(days)) });
  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, t)} onRetry={() => q.refetch()} retryLabel={t.common.retry} />;
  const o = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t.admin.dashboard} actions={<>
        <PeriodSelect days={days} onChange={setDays} />
        <Button asChild><Link href="/admin/players?create=1"><UserPlus /> {t.admin.createPlayer}</Link></Button>
      </>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Wallet />} label={t.admin.walletBalance} value={formatCredits(o.balance)} sub={`${t.admin.received}: ${formatCredits(o.received_total)}`} tone="accent" />
        <Stat icon={<Users />} label={t.admin.ownedPlayers} value={o.players.total} sub={`${t.admin.activePlayers}: ${o.players.active} · ${t.common.suspended}: ${o.players.suspended}`} />
        <Stat icon={<ArrowUpRight />} label={t.admin.distributed} value={formatCredits(o.distributed_total)} sub={`${t.common.period}: ${formatCredits(o.distributed_period)}`} />
        <Stat icon={<ArrowDownLeft />} label={t.admin.returned} value={formatCredits(o.returned_total)} sub={`${t.common.period}: ${formatCredits(o.returned_period)}`} />
        <Stat icon={<Receipt />} label={t.admin.openBets} value={o.bets.open} sub={`${t.admin.exposure}: ${formatCredits(o.bets.open_exposure)}`} />
        <Stat icon={<Receipt />} label={t.admin.settledBets} value={o.bets.settled} />
        <Stat label={t.admin.playerBalances} value={formatCredits(o.players_balance)} />
        <Stat label={t.admin.wagered} value={formatCredits(o.wagering.sports_staked + o.wagering.casino_staked)}
          sub={`${t.admin.returnedToPlayers}: ${formatCredits(o.wagering.sports_returned + o.wagering.casino_returned)}`} />
      </div>
      <Card><CardHeader title={t.admin.wagered} /><DailyChart data={o.daily} /></Card>
      <Card>
        <CardHeader title={t.admin.gameActivity} />
        <Table>
          <THead><tr><TH>{t.common.game}</TH><TH className="text-right">#</TH><TH className="text-right">{t.common.stake}</TH><TH className="text-right">{t.common.payout}</TH></tr></THead>
          <TBody>
            {o.games.length === 0 && <tr><TD colSpan={4} className="text-center text-muted-foreground">{t.common.empty}</TD></tr>}
            {o.games.map((g) => (
              <TR key={g.game_id}><TD>{g.game_id}</TD><TD className="text-right">{g.rounds}</TD><TD className="text-right tabular-nums">{formatCredits(g.staked)}</TD><TD className="text-right tabular-nums">{formatCredits(g.paid)}</TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
