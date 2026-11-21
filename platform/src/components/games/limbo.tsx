"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GameShell, ProfitLine, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { result: number; win: boolean; win_chance: number };

export function LimboGame({ edgeBps }: { edgeBps: number }) {
  const { t } = useI18n();
  const g = useGame();
  const [target, setTarget] = useState("2.00");
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [shown, setShown] = useState(1);
  const tv = Number(target);
  const valid = Number.isFinite(tv) && tv >= 1.01 && tv <= 1_000_000;

  useEffect(() => {
    if (!last) return;
    const end = Number(last.state.result);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 600);
      setShown(1 + (end - 1) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [last]);

  async function play() {
    const units = g.units();
    if (!units || !valid) return;
    const r = await g.call<S>("play_limbo", { p_stake: units, p_target: tv.toFixed(2) });
    if (r) setLast(r);
  }

  return (
    <GameShell gameId="limbo"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <div><Label>{t.casino.games.limbo.targetMultiplier}</Label><Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={!valid} /></div>
        <p className="text-sm text-muted-foreground">{t.casino.winChance}: <span className="font-semibold text-foreground">{valid ? ((1 - edgeBps / 10000) / tv * 100).toFixed(4) : "—"}%</span></p>
        <ProfitLine stakeUnits={g.stakeUnits} multiplier={valid ? tv : NaN} />
        <Button className="w-full" size="lg" onClick={play} loading={g.busy} disabled={!g.stakeUnits || !valid}>{t.casino.bet}</Button>
      </>}
      stage={<>
        <ResultBanner status={last?.status} multiplier={last?.multiplier} payout={last?.payout} />
        <p className={cn("text-7xl font-extrabold tabular-nums", !last ? "text-muted-foreground" : last.state.win ? "text-success" : "text-danger")}>
          {shown.toFixed(2)}×
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t.casino.target}: {valid ? tv.toFixed(2) : "—"}×</p>
      </>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
