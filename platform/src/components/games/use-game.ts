"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useProfile } from "@/components/providers";
import { useSetBalance } from "@/hooks/use-balance";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { parseCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { newKey } from "@/lib/utils";

export interface RoundView<S = Record<string, unknown>> {
  round_id: string; game_id: string; status: "active" | "won" | "lost" | "push" | "cancelled";
  stake: number; payout: number; multiplier: string | number; params: Record<string, unknown>; state: S;
  edge_bps: number; nonce: number | null; client_seed: string | null; server_seed_hash: string | null; balance: number;
  server_multiplier?: number; elapsed?: number;
}

/** Shared state + server calls for a casino game. All outcomes come from the server. */
export function useGame(defaultStake = "1.00") {
  const { t } = useI18n();
  const p = useProfile();
  const setBalance = useSetBalance(p.id);
  const qc = useQueryClient();
  const [stake, setStake] = useState(defaultStake);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ id: string; mult: number; win: boolean }[]>([]);
  const stakeUnits = parseCredits(stake);

  async function call<S = Record<string, unknown>>(fn: string, args: Record<string, unknown>, opts: { idempotent?: boolean; deferBalance?: boolean } = {}) {
    setBusy(true);
    try {
      const r = await rpc<RoundView<S>>(fn, opts.idempotent === false ? args : { ...args, p_idempotency_key: newKey() });
      if (!opts.deferBalance) setBalance(r.balance);
      if (r.status !== "active") {
        setHistory((h) => [{ id: r.round_id, mult: Number(r.multiplier), win: r.status === "won" }, ...h].slice(0, 12));
        qc.invalidateQueries({ queryKey: ["rounds"] });
      }
      return r;
    } catch (e) {
      toast.error(errorMessage(e, t));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { stake, setStake, stakeUnits, busy, setBusy, call, history, setBalance, units: () => stakeUnits?.toString() ?? null };
}
