"use client";
import { Card, PageHeader } from "@/components/ui/card";
import { LedgerTable } from "@/components/wallet/ledger-table";
import { ReverseButton } from "@/components/admin/reverse-button";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";

export default function AdminTransactions() {
  const { t } = useI18n();
  const me = useProfile();
  return (
    <div className="space-y-6">
      <PageHeader title={t.nav.transactions} />
      <Card><LedgerTable userId={me.id} renderAction={(tx) => <ReverseButton txId={tx.id} txType={tx.tx_type} types={["player_credit", "player_return"]} />} /></Card>
    </div>
  );
}
