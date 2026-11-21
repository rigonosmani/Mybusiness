"use client";
import { supabaseBrowser } from "./supabase/client";

export interface BetRow {
  id: string; bet_type: string; stake: number; total_odds: string; potential_payout: number; status: string;
  payout: number | null; placed_at: string; settled_at: string | null;
  bet_selections: { id: string; event_name: string; market_key: string; outcome_label: string; odds: string; result: string; commence_time: string; was_live: boolean }[];
}

export async function fetchBets(opts: { userId: string; open?: boolean; limit?: number }) {
  let q = supabaseBrowser().from("bets")
    .select("id, bet_type, stake, total_odds, potential_payout, status, payout, placed_at, settled_at, bet_selections(id, event_name, market_key, outcome_label, odds, result, commence_time, was_live)")
    .eq("user_id", opts.userId).order("placed_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.open !== undefined) q = opts.open ? q.eq("status", "open") : q.neq("status", "open");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as BetRow[];
}
