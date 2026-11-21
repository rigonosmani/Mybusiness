"use client";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { Dropdown } from "@/components/ui/dropdown";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatCredits } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

interface Row { id: number; amount: number; created_at: string; ledger_transactions: { tx_type: string } | null }

/** Credits received (admin transfers, bet/game payouts, refunds), newest first. */
export function Notifications() {
  const p = useProfile();
  const { t, locale } = useI18n();
  const [seen, setSeen] = useState<string>("");
  useEffect(() => setSeen(localStorage.getItem(`kometa-seen-${p.id}`) ?? ""), [p.id]);
  const { data = [] } = useQuery({
    queryKey: ["notifications", p.id],
    refetchInterval: 30_000,
    queryFn: async () => {
      const sb = supabaseBrowser();
      const { data: w } = await sb.from("wallets").select("account_id").eq("user_id", p.id).single();
      if (!w) return [];
      const { data } = await sb.from("ledger_entries")
        .select("id, amount, created_at, ledger_transactions(tx_type)")
        .eq("account_id", w.account_id).gt("amount", 0).order("created_at", { ascending: false }).limit(8);
      return (data ?? []) as unknown as Row[];
    },
  });
  const unread = data.filter((r) => r.created_at > seen).length;
  return (
    <Dropdown trigger={
      <button className="relative rounded-md p-2 text-muted-foreground hover:bg-panel-3 hover:text-foreground" aria-label={t.nav.notifications}
        onClick={() => { if (data[0]) { localStorage.setItem(`kometa-seen-${p.id}`, data[0].created_at); setTimeout(() => setSeen(data[0].created_at), 1500); } }}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-bold text-black">{unread}</span>}
      </button>
    }>
      <div className="w-72 p-1">
        <p className="px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground">{t.nav.notifications}</p>
        {data.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{t.common.empty}</p>}
        {data.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm">
            <div>
              <p>{(t.wallet.txTypes as Record<string, string>)[r.ledger_transactions?.tx_type ?? ""] ?? r.ledger_transactions?.tx_type}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(r.created_at, locale)}</p>
            </div>
            <span className="font-semibold text-success tabular-nums">+{formatCredits(r.amount)}</span>
          </div>
        ))}
      </div>
    </Dropdown>
  );
}
