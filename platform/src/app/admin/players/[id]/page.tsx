"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Card, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LedgerTable } from "@/components/wallet/ledger-table";
import { BetList } from "@/components/sports/bet-list";
import { RoundsTable } from "@/components/casino/rounds-table";
import { ReverseButton } from "@/components/admin/reverse-button";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { fetchBets } from "@/lib/bets";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

interface Report {
  profile: { id: string; username: string; display_name: string; status: string; created_at: string; last_login_at: string | null };
  balance: number;
  lifetime: { sports_staked: number; sports_returned: number; casino_staked: number; casino_returned: number };
  bets: { open: number; won: number; lost: number; void: number };
  rounds: number;
  limits: { self_excluded_until: string | null } | null;
}

export default function PlayerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const [tab, setTab] = useState("wallet");
  const r = useQuery({ queryKey: ["player-report", id], queryFn: () => rpc<Report>("admin_player_report", { p_player_id: id }) });
  const bets = useQuery({ queryKey: ["bets", id, "all"], queryFn: () => fetchBets({ userId: id }), enabled: tab === "bets" });
  if (r.isLoading) return <SkeletonRows rows={6} />;
  if (r.error || !r.data) return <ErrorState message={errorMessage(r.error, t)} />;
  const d = r.data;
  return (
    <div className="space-y-6">
      <Link href="/admin/players" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t.common.back}</Link>
      <PageHeader title={d.profile.display_name} description={`@${d.profile.username} · ${t.common.created} ${formatDateTime(d.profile.created_at, locale)} · ${t.common.lastLogin}: ${d.profile.last_login_at ? formatDateTime(d.profile.last_login_at, locale) : t.common.never}`}
        actions={<StatusBadge status={d.profile.status} labels={{ active: t.common.active, suspended: t.common.suspended, deactivated: t.common.deactivated }} />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t.common.balance} value={formatCredits(d.balance)} tone="accent" />
        <Stat label={t.casino.title} value={formatCredits(d.lifetime.casino_staked)} sub={`${t.common.payout}: ${formatCredits(d.lifetime.casino_returned)} · ${d.rounds} ${t.casino.round}`} />
        <Stat label={t.sports.title} value={formatCredits(d.lifetime.sports_staked)} sub={`${t.common.payout}: ${formatCredits(d.lifetime.sports_returned)}`} />
        <Stat label={t.admin.openBets} value={d.bets.open} sub={`${t.common.won} ${d.bets.won} · ${t.common.lost} ${d.bets.lost} · ${t.common.void} ${d.bets.void}`} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="wallet">{t.admin.viewWallet}</TabsTrigger>
          <TabsTrigger value="bets">{t.admin.viewBets}</TabsTrigger>
          <TabsTrigger value="rounds">{t.admin.viewRounds}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        {tab === "wallet" && <LedgerTable userId={id} renderAction={(tx) => <ReverseButton txId={tx.id} txType={tx.tx_type} types={["player_credit", "player_return"]} />} />}
        {tab === "bets" && <BetList query={bets} />}
        {tab === "rounds" && <RoundsTable userId={id} />}
      </Card>
    </div>
  );
}
