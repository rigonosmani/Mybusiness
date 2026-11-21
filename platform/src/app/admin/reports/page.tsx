"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DailyChart, PeriodSelect, periodArgs } from "@/components/admin/charts";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { houseResult, type AdminOverview } from "@/lib/reports";

export default function AdminReports() {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["admin-overview", days], queryFn: () => rpc<AdminOverview>("admin_overview", periodArgs(days)) });
  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, t)} />;
  const o = q.data;
  const w = o.wagering;
  const hr = houseResult(w);
  return (
    <div className="space-y-6">
      <PageHeader title={t.nav.reports} actions={<PeriodSelect days={days} onChange={setDays} />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t.super.sportsStaked} value={formatCredits(w.sports_staked)} sub={`${t.common.payout}: ${formatCredits(w.sports_returned)}`} />
        <Stat label={t.super.casinoStaked} value={formatCredits(w.casino_staked)} sub={`${t.common.payout}: ${formatCredits(w.casino_returned)}`} />
        <Stat label={t.super.houseResult} value={formatCredits(hr)} tone={hr >= 0 ? "good" : "bad"} />
        <Stat label={t.admin.distributed} value={formatCredits(o.distributed_period)} sub={`${t.admin.returned}: ${formatCredits(o.returned_period)}`} />
      </div>
      <Card><CardHeader title={t.admin.wagered} /><DailyChart data={o.daily} /></Card>
      <Card>
        <CardHeader title={t.admin.gameActivity} />
        <Table>
          <THead><tr><TH>{t.common.game}</TH><TH className="text-right">#</TH><TH className="text-right">{t.common.stake}</TH><TH className="text-right">{t.common.payout}</TH><TH className="text-right">{t.casino.rtp}</TH></tr></THead>
          <TBody>
            {o.games.map((g) => (
              <TR key={g.game_id}><TD>{g.game_id}</TD><TD className="text-right">{g.rounds}</TD><TD className="text-right tabular-nums">{formatCredits(g.staked)}</TD>
                <TD className="text-right tabular-nums">{formatCredits(g.paid)}</TD><TD className="text-right tabular-nums">{g.staked ? ((g.paid / g.staked) * 100).toFixed(2) : "—"}%</TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
