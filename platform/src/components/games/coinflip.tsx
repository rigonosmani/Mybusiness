"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GameShell, ProfitLine, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { result: "heads" | "tails"; win: boolean };

export function CoinflipGame({ edgeBps }: { edgeBps: number }) {
  const { t } = useI18n();
  const g = useGame();
  const [side, setSide] = useState<"heads" | "tails">("heads");
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const mult = Math.floor(2 * (1 - edgeBps / 10000) * 10000) / 10000;

  async function flip() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("play_coinflip", { p_stake: units, p_side: side });
    if (r) { setLast(r); setSpinKey((k) => k + 1); }
  }
  const face = last?.state.result ?? side;
  return (
    <GameShell gameId="coinflip"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <div className="grid grid-cols-2 gap-1">
          {(["heads", "tails"] as const).map((s) => (
            <Button key={s} variant={side === s ? "default" : "secondary"} onClick={() => setSide(s)} disabled={g.busy}>{t.casino.games.coinflip[s]}</Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t.common.multiplier}: <span className="font-semibold text-foreground">{mult.toFixed(4)}×</span></p>
        <ProfitLine stakeUnits={g.stakeUnits} multiplier={mult} />
        <Button className="w-full" size="lg" onClick={flip} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.coinflip.flip}</Button>
      </>}
      stage={<>
        <ResultBanner status={last?.status} multiplier={last?.multiplier} payout={last?.payout} />
        <div key={spinKey} className={cn("grid size-44 place-items-center rounded-full border-8 text-2xl font-extrabold uppercase shadow-2xl [transform-style:preserve-3d]",
          spinKey > 0 && "animate-flip",
          face === "heads" ? "border-amber-300 bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950" : "border-slate-300 bg-gradient-to-br from-slate-200 to-slate-500 text-slate-900")}>
          {t.casino.games.coinflip[face]}
        </div>
      </>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
