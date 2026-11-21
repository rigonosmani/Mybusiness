"use client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits } from "@/lib/money";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatDateTime } from "@/lib/utils";

interface EntryRow {
  id: number; amount: number; balance_after: number; created_at: string;
  ledger_transactions: { id: string; tx_type: string; reference: string | null; description: string | null; reverses_tx_id: string | null } | null;
}

export async function fetchLedger(userId: string, limit = 200) {
  const sb = supabaseBrowser();
  const { data: w, error: we } = await sb.from("wallets").select("account_id").eq("user_id", userId).single();
  if (we) throw we;
  const { data, error } = await sb.from("ledger_entries")
    .select("id, amount, balance_after, created_at, ledger_transactions(id, tx_type, reference, description, reverses_tx_id)")
    .eq("account_id", w.account_id).order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as EntryRow[];
}

/** Ledger of one wallet (RLS decides whether the caller may see it). */
export function LedgerTable({ userId, renderAction }: { userId: string; renderAction?: (tx: NonNullable<EntryRow["ledger_transactions"]>) => React.ReactNode }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ["ledger", userId], queryFn: () => fetchLedger(userId) });
  if (q.isLoading) return <SkeletonRows />;
  if (q.error) return <ErrorState message={errorMessage(q.error, t)} onRetry={() => q.refetch()} retryLabel={t.common.retry} />;
  if (!q.data?.length) return <EmptyState title={t.common.empty} icon={<BookOpen />} />;
  return (
    <Table>
      <THead><tr><TH>{t.common.date}</TH><TH>{t.common.type}</TH><TH>{t.common.reference}</TH><TH className="text-right">{t.common.amount}</TH><TH className="text-right">{t.common.balance}</TH>{renderAction && <TH />}</tr></THead>
      <TBody>
        {q.data.map((e) => (
          <TR key={e.id}>
            <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at, locale)}</TD>
            <TD>{(t.wallet.txTypes as Record<string, string>)[e.ledger_transactions?.tx_type ?? ""] ?? e.ledger_transactions?.tx_type}</TD>
            <TD className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground" title={e.ledger_transactions?.reference ?? ""}>
              {e.ledger_transactions?.description || e.ledger_transactions?.reference || "—"}
            </TD>
            <TD className={cn("text-right font-semibold tabular-nums", e.amount > 0 ? "text-success" : "text-danger")}>{e.amount > 0 ? "+" : ""}{formatCredits(e.amount)}</TD>
            <TD className="text-right tabular-nums">{formatCredits(e.balance_after)}</TD>
            {renderAction && <TD className="text-right">{e.ledger_transactions && renderAction(e.ledger_transactions)}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
