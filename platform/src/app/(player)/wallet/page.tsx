"use client";
import { Wallet } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { LedgerTable } from "@/components/wallet/ledger-table";
import { useProfile } from "@/components/providers";
import { useBalance } from "@/hooks/use-balance";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";

export default function WalletPage() {
  const { t } = useI18n();
  const p = useProfile();
  const balance = useBalance(p.id);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t.wallet.title} />
      <Card className="card-shine flex items-center gap-4">
        <div className="rounded-lg bg-primary/15 p-3 text-primary"><Wallet className="size-7" /></div>
        <div>
          <p className="text-sm text-muted-foreground">{t.wallet.available}</p>
          <p className="text-3xl font-extrabold tabular-nums">{formatCredits(balance.data)}</p>
        </div>
      </Card>
      <Notice>{t.wallet.noValue}</Notice>
      <Card><CardHeader title={t.wallet.ledger} /><LedgerTable userId={p.id} /></Card>
    </div>
  );
}
