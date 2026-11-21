"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GameShell, ProfitLine, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { roll: number; win: boolean; payout_multiplier: number };

export function DiceGame({ edgeBps }: { edgeBps: number }) {
  const { t } = useI18n();
  const g = useGame();
  const [target, setTarget] = useState(50);
  const [dir, setDir] = useState<"under" | "over">("under");
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const chance = dir === "under" ? target : 99.99 - target;
  const mult = Math.floor(((1 - edgeBps / 10000) / (chance / 100)) * 10000) / 10000;

  async function roll() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("play_dice", { p_stake: units, p_target: target.toFixed(2), p_direction: dir });
    if (r) setLast(r);
  }

  const roll_ = last ? Number(last.state.roll) : null;
  return (
    <GameShell gameId="dice"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <div>
          <Label>{t.casino.target}</Label>
          <div className="grid grid-cols-2 gap-1">
            {(["under", "over"] as const).map((d) => (
              <Button key={d} type="button" variant={dir === d ? "default" : "secondary"} onClick={() => setDir(d)} disabled={g.busy}>
                {d === "under" ? t.casino.games.dice.rollUnder : t.casino.games.dice.rollOver}
              </Button>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-panel-2 p-2"><dt className="text-xs text-muted-foreground">{t.common.multiplier}</dt><dd className="font-bold tabular-nums">{mult.toFixed(4)}×</dd></div>
          <div className="rounded-md bg-panel-2 p-2"><dt className="text-xs text-muted-foreground">{t.casino.winChance}</dt><dd className="font-bold tabular-nums">{chance.toFixed(2)}%</dd></div>
        </dl>
        <ProfitLine stakeUnits={g.stakeUnits} multiplier={mult} />
        <Button className="w-full" size="lg" onClick={roll} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.dice.roll}</Button>
      </>}
      stage={<div className="w-full max-w-xl px-6">
        <ResultBanner status={last?.status} multiplier={last?.multiplier} payout={last?.payout} />
        <p className={cn("mb-8 text-center text-6xl font-extrabold tabular-nums transition-colors", last ? (last.state.win ? "text-success" : "text-danger") : "text-muted-foreground")}>
          {roll_ !== null ? roll_.toFixed(2) : "00.00"}
        </p>
        <div className="relative h-3 rounded-full" style={{
          background: dir === "under"
            ? `linear-gradient(90deg, hsl(var(--success)) ${target}%, hsl(var(--danger)) ${target}%)`
            : `linear-gradient(90deg, hsl(var(--danger)) ${target}%, hsl(var(--success)) ${target}%)`,
        }}>
          {roll_ !== null && (
            <div className="absolute -top-8 -translate-x-1/2 transition-all duration-500" style={{ left: `${roll_}%` }}>
              <div className="rounded bg-foreground px-1.5 py-0.5 text-xs font-bold text-background">{roll_.toFixed(2)}</div>
            </div>
          )}
        </div>
        <input type="range" min={dir === "under" ? 1 : 1.99} max={dir === "under" ? 98 : 98.99} step={0.01} value={target}
          onChange={(e) => setTarget(Number(e.target.value))} disabled={g.busy} aria-label={t.casino.target}
          className="mt-4 w-full accent-[hsl(var(--primary))]" />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0</span><span>{target.toFixed(2)}</span><span>100</span></div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
