"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { path: number[]; bucket: number; table: number[] };

export function PlinkoGame() {
  const { t } = useI18n();
  const g = useGame();
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [step, setStep] = useState(-1);
  const table = useQuery({ queryKey: ["plinko-table", rows, risk], queryFn: () => rpc<number[]>("plinko_table", { p_rows: rows, p_risk: risk }) });

  useEffect(() => {
    if (!last) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => {
      if (s >= last.state.path.length) { clearInterval(id); return s; }
      return s + 1;
    }), 110);
    return () => clearInterval(id);
  }, [last]);

  async function drop() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("play_plinko", { p_stake: units, p_rows: rows, p_risk: risk });
    if (r) setLast(r);
  }

  const n = last && last.params.rows === rows ? rows : rows;
  const path = last?.state.path ?? [];
  const pos = path.slice(0, Math.max(0, step)).reduce((a, b) => a + b, 0);
  const ballX = 50 + (pos - Math.max(0, step) / 2) * (80 / (n + 1));
  const ballY = 8 + Math.max(0, step) * (80 / n);
  const done = last && step >= path.length;
  const colour = (m: number) => (m >= 10 ? "bg-danger text-white" : m >= 2 ? "bg-accent text-black" : m >= 1 ? "bg-primary text-black" : "bg-panel-3 text-foreground");

  return (
    <GameShell gameId="plinko"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <div className="grid grid-cols-2 gap-2">
          <div><Label>{t.casino.games.plinko.rows}</Label><Select value={rows} onChange={(e) => setRows(Number(e.target.value))}>{[8, 12, 16].map((r) => <option key={r}>{r}</option>)}</Select></div>
          <div><Label>{t.casino.games.plinko.risk}</Label>
            <Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
              {(["low", "medium", "high"] as const).map((r) => <option key={r} value={r}>{t.casino.games.plinko[r]}</option>)}
            </Select>
          </div>
        </div>
        <Button className="w-full" size="lg" onClick={drop} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.plinko.drop}</Button>
      </>}
      stage={<div className="relative w-full max-w-xl p-4">
        {done && <ResultBanner status={last?.status} multiplier={last?.multiplier} payout={last?.payout} />}
        <svg viewBox="0 0 100 92" className="w-full" aria-hidden>
          {Array.from({ length: n }, (_, r) => Array.from({ length: r + 3 }, (_, c) => (
            <circle key={`${r}-${c}`} cx={50 + (c - (r + 2) / 2) * (80 / (n + 1))} cy={8 + (r + 0.5) * (80 / n)} r={0.9} fill="hsl(var(--muted-foreground))" />
          )))}
          {last && step >= 0 && <circle cx={ballX} cy={ballY} r={1.8} fill="hsl(var(--accent))" className="transition-all duration-100" />}
        </svg>
        <div className="mt-1 flex gap-0.5">
          {(table.data ?? []).map((m, i) => (
            <div key={i} className={cn("flex-1 rounded py-1 text-center text-[9px] font-bold tabular-nums sm:text-[11px]", colour(Number(m)),
              done && last?.state.bucket === i && "ring-2 ring-white")}>
              {Number(m) >= 100 ? Math.round(Number(m)) : Number(m).toFixed(1)}
            </div>
          ))}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
