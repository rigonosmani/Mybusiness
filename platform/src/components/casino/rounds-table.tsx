"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { History } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";

export function RoundsTable({ userId, showVerify }: { userId: string; showVerify?: boolean }) {
  const { t, locale } = useI18n();
  const q = useQuery({
    queryKey: ["rounds", userId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().from("game_rounds")
        .select("id, game_id, stake, payout, multiplier, status, nonce, client_seed, server_seed_hash, edge_bps, params, created_at, casino_games(name)")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as { id: string; game_id: string; stake: number; payout: number; multiplier: string; status: string; nonce: number | null;
        client_seed: string | null; server_seed_hash: string | null; edge_bps: number; params: Record<string, unknown>; created_at: string; casino_games: { name: string } | null }[];
    },
  });
  if (q.isLoading) return <SkeletonRows />;
  if (!q.data?.length) return <EmptyState title={t.history.noRounds} icon={<History />} />;
  return (
    <Table>
      <THead><tr><TH>{t.common.time}</TH><TH>{t.common.game}</TH><TH className="text-right">{t.common.stake}</TH><TH className="text-right">{t.common.multiplier}</TH><TH className="text-right">{t.common.payout}</TH><TH>{t.common.status}</TH>{showVerify && <TH />}</tr></THead>
      <TBody>
        {q.data.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at, locale)}</TD>
            <TD>{r.casino_games?.name ?? r.game_id}</TD>
            <TD className="text-right tabular-nums">{formatCredits(r.stake)}</TD>
            <TD className="text-right tabular-nums">{Number(r.multiplier).toFixed(2)}×</TD>
            <TD className="text-right font-semibold tabular-nums">{formatCredits(r.payout)}</TD>
            <TD><StatusBadge status={r.status} labels={{ won: t.common.won, lost: t.common.lost, push: t.common.push, active: t.common.open }} /></TD>
            {showVerify && (
              <TD className="text-right">
                {r.nonce !== null && r.status !== "active" && (
                  <Link className="text-xs font-semibold text-primary hover:underline"
                    href={`/fairness?game=${r.game_id}&nonce=${r.nonce}&client=${encodeURIComponent(r.client_seed ?? "")}&hash=${r.server_seed_hash}&edge=${r.edge_bps}&params=${encodeURIComponent(JSON.stringify(r.params))}`}>
                    {t.history.verify}
                  </Link>
                )}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

