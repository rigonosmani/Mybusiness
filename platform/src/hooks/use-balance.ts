"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { rpc } from "@/lib/rpc";

/** Live wallet balance (units as string). Server value only — never computed client-side. */
export function useBalance(userId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["balance", userId],
    queryFn: async () => String(await rpc<number | string>("my_balance")),
  });

  useEffect(() => {
    const sb = supabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("wallets").select("account_id").eq("user_id", userId).single();
      if (!data || cancelled) return;
      channel = sb
        .channel(`wallet:${data.account_id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ledger_accounts", filter: `id=eq.${data.account_id}` },
          (payload) => qc.setQueryData(["balance", userId], String((payload.new as { balance: number }).balance)))
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [userId, qc]);

  return q;
}

/** Push a server-returned balance into the cache right after an RPC. */
export function useSetBalance(userId: string) {
  const qc = useQueryClient();
  return (balance: number | string | null | undefined) => {
    if (balance !== null && balance !== undefined) qc.setQueryData(["balance", userId], String(balance));
  };
}
