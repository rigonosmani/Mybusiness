"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useProfile } from "@/components/providers";
import { useSetBalance } from "@/hooks/use-balance";
import { useI18n } from "@/lib/i18n";
import { errorCodeOf, errorMessage } from "@/lib/errors";
import { formatCredits, parseCredits, potentialReturn, totalOdds } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, newKey } from "@/lib/utils";
import { useBetSlip } from "@/stores/betslip";

/** Re-reads the current offered odds of every selection from the server. */
async function refreshOdds(ids: string[]) {
  if (!ids.length) return new Map<string, { odds: string; open: boolean }>();
  const { data } = await supabaseBrowser()
    .from("market_outcomes").select("id, offered_odds, status, betting_markets(status)").in("id", ids);
  return new Map((data ?? []).map((o: { id: string; offered_odds: string | number; status: string; betting_markets: { status: string } | { status: string }[] | null }) => {
    const m = Array.isArray(o.betting_markets) ? o.betting_markets[0] : o.betting_markets;
    return [o.id, { odds: Number(o.offered_odds).toFixed(2), open: o.status === "open" && m?.status === "open" }];
  }));
}

export function BetSlip({ onPlaced }: { onPlaced?: () => void }) {
  const { t } = useI18n();
  const profile = useProfile();
  const setBalance = useSetBalance(profile.id);
  const qc = useQueryClient();
  const { selections, mode, stake, remove, clear, setMode, setStake, updateOdds } = useBetSlip();
  const [pending, setPending] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const keyRef = useRef<string>(newKey());

  // New key whenever the slip content changes (a retry of the same slip reuses it).
  useEffect(() => { keyRef.current = newKey(); }, [selections, mode, stake]);

  // Keep quoted prices current.
  useEffect(() => {
    if (!selections.length) return;
    let active = true;
    const tick = async () => {
      const fresh = await refreshOdds(selections.map((s) => s.outcomeId));
      if (!active) return;
      const shut = new Set<string>();
      for (const s of selections) {
        const f = fresh.get(s.outcomeId);
        if (!f || !f.open) shut.add(s.outcomeId);
        else if (f.odds !== s.odds) updateOdds(s.outcomeId, f.odds);
      }
      setClosed(shut);
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { active = false; clearInterval(id); };
  }, [selections.map((s) => s.outcomeId).join(","), updateOdds]); // eslint-disable-line react-hooks/exhaustive-deps

  const stakeUnits = parseCredits(stake);
  const isAcca = mode === "accumulator" && selections.length > 1;
  const odds = selections.map((s) => s.odds);
  const totalStake = stakeUnits === null ? null : isAcca ? stakeUnits : stakeUnits * BigInt(selections.length);
  const potential = useMemo(() => {
    if (stakeUnits === null) return 0n;
    return isAcca ? potentialReturn(stakeUnits, odds) : odds.reduce((a, o) => a + potentialReturn(stakeUnits, [o]), 0n);
  }, [stakeUnits, isAcca, odds]);

  async function place() {
    if (stakeUnits === null || stakeUnits <= 0n) return toast.error(t.errors.INVALID_AMOUNT);
    setPending(true);
    try {
      const r = await rpc<{ balance: number }>("place_bets", {
        p_slip: {
          mode: isAcca ? "accumulator" : "singles",
          stake: stakeUnits.toString(),
          selections: selections.map((s) => ({ outcome_id: s.outcomeId, odds: s.odds })),
        },
        p_idempotency_key: keyRef.current,
      });
      setBalance(r.balance);
      toast.success(t.slip.placed);
      clear();
      qc.invalidateQueries({ queryKey: ["bets"] });
      onPlaced?.();
    } catch (e) {
      const code = errorCodeOf(e);
      if (code === "ODDS_CHANGED" || code === "MARKET_SUSPENDED" || code === "ODDS_STALE") {
        const fresh = await refreshOdds(selections.map((s) => s.outcomeId));
        fresh.forEach((f, id) => updateOdds(id, f.odds));
        setClosed(new Set([...fresh].filter(([, f]) => !f.open).map(([id]) => id)));
        toast.warning(`${t.slip.oddsUpdated}. ${errorMessage(e, t)}`);
      } else {
        toast.error(errorMessage(e, t));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><Receipt className="size-4 text-primary" /> {t.slip.title}
          {selections.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{selections.length}</span>}
        </h2>
        {selections.length > 0 && <Button variant="ghost" size="sm" onClick={clear}><Trash2 /> {t.slip.clear}</Button>}
      </div>
      {selections.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t.slip.empty}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 p-3">
            {(["singles", "accumulator"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} disabled={m === "accumulator" && selections.length < 2}
                className={cn("rounded-md py-1.5 text-sm font-medium disabled:opacity-40", mode === m ? "bg-panel-3" : "text-muted-foreground hover:bg-panel-2")}>
                {m === "singles" ? t.slip.singles : t.slip.accumulator}
              </button>
            ))}
          </div>
          <ul className="flex-1 space-y-2 overflow-y-auto px-3 scrollbar-thin">
            {selections.map((s) => (
              <li key={s.outcomeId} className={cn("rounded-md border border-border bg-panel-2 p-3 text-sm", closed.has(s.outcomeId) && "opacity-50")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{(t.sports.markets as Record<string, string>)[s.marketKey] ?? s.marketKey}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.eventName}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-primary tabular-nums">{closed.has(s.outcomeId) ? t.sports.suspended : s.odds}</span>
                    <button onClick={() => remove(s.outcomeId)} aria-label={t.slip.remove} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-3 border-t border-border p-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{isAcca ? t.slip.stake : t.slip.stakePerBet} (Cr)</span>
              <Input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-invalid={stakeUnits === null} />
            </label>
            <dl className="space-y-1 text-sm">
              {isAcca && <div className="flex justify-between"><dt className="text-muted-foreground">{t.slip.totalOdds}</dt><dd className="font-semibold tabular-nums">{totalOdds(odds)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">{t.slip.totalStake}</dt><dd className="tabular-nums">{totalStake === null ? "—" : formatCredits(totalStake)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t.slip.potentialReturn}</dt><dd className="font-bold text-success tabular-nums">{formatCredits(potential)}</dd></div>
            </dl>
            <Button className="w-full" size="lg" loading={pending} disabled={stakeUnits === null || closed.size > 0} onClick={place}>{t.slip.place}</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function BetSlipMobileButton() {
  const { t } = useI18n();
  const { selections, open, setOpen } = useBetSlip();
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return (
    <>
      {selections.length > 0 && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-xl xl:hidden">
          <Receipt className="size-5" /> {t.slip.title} <span className="rounded-full bg-black/20 px-2 text-sm">{selections.length}</span>
        </button>
      )}
      <Sheet open={open && mobile} onOpenChange={setOpen} side="bottom" title={t.slip.title}>
        <div className="h-[80vh]"><BetSlip onPlaced={() => setOpen(false)} /></div>
      </Sheet>
    </>
  );
}
