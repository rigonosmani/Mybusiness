"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { number: number; returned: number };
type Bet = { type: string; value?: number; amount: number };
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const colour = (n: number) => (n === 0 ? "bg-emerald-600" : RED.has(n) ? "bg-red-600" : "bg-slate-900");

export function RouletteGame() {
  const { t } = useI18n();
  const r = t.casino.games.roulette;
  const g = useGame("1.00");
  const [bets, setBets] = useState<Bet[]>([]);
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [angle, setAngle] = useState(0);
  const total = bets.reduce((a, b) => a + b.amount, 0);

  const add = (type: string, value?: number) => {
    const units = g.stakeUnits;
    if (!units) return;
    setBets((bs) => {
      const i = bs.findIndex((b) => b.type === type && b.value === value);
      if (i >= 0) return bs.map((b, j) => (j === i ? { ...b, amount: b.amount + Number(units) } : b));
      return [...bs, { type, value, amount: Number(units) }];
    });
  };
  const amountOn = (type: string, value?: number) => bets.find((b) => b.type === type && b.value === value)?.amount;

  async function spin() {
    if (!bets.length) return;
    const res = await g.call<S>("play_roulette", { p_bets: bets.map((b) => ({ type: b.type, value: b.value, amount: b.amount })) });
    if (!res) return;
    const idx = WHEEL.indexOf(res.state.number);
    setAngle((a) => a - (a % 360) + 360 * 5 - idx * (360 / 37));
    setTimeout(() => setLast(res), 2600);
  }

  const Cell = ({ type, value, label, className }: { type: string; value?: number; label: string; className?: string }) => {
    const amt = amountOn(type, value);
    return (
      <button onClick={() => add(type, value)} disabled={g.busy}
        className={cn("relative flex items-center justify-center rounded text-xs font-bold text-white transition hover:brightness-125 sm:text-sm", className)}>
        {label}
        {amt && <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1 text-[9px] text-black">{formatCredits(amt, { suffix: false })}</span>}
      </button>
    );
  };

  return (
    <GameShell gameId="roulette"
      controls={<>
        <StakeInput label={r.chip} value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <div className="flex justify-between text-sm"><Label className="mb-0">{r.totalBet}</Label><span className="font-bold tabular-nums">{formatCredits(total)}</span></div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setBets([])} disabled={g.busy || !bets.length}>{r.clearBets}</Button>
          <Button onClick={spin} loading={g.busy} disabled={!bets.length}>{r.spin}</Button>
        </div>
      </>}
      stage={<div className="flex w-full flex-col items-center gap-4 p-3">
        {last && <ResultBanner status={last.status} multiplier={last.multiplier} payout={last.payout} />}
        <div className="relative size-48">
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-accent" />
          <svg viewBox="-50 -50 100 100" className="size-full transition-transform duration-[2500ms] ease-[cubic-bezier(.15,.85,.25,1)]" style={{ transform: `rotate(${angle}deg)` }} aria-hidden>
            {WHEEL.map((n, i) => {
              const a0 = (i * 360) / 37 - 90 - 360 / 74, a1 = a0 + 360 / 37;
              const p = (a: number, rr: number) => `${rr * Math.cos((a * Math.PI) / 180)},${rr * Math.sin((a * Math.PI) / 180)}`;
              return (
                <g key={n}>
                  <path d={`M0,0 L${p(a0, 48)} A48,48 0 0 1 ${p(a1, 48)} Z`} fill={n === 0 ? "#059669" : RED.has(n) ? "#dc2626" : "#0f172a"} stroke="#1e293b" strokeWidth=".3" />
                  <text x={p(a0 + 360 / 74, 41).split(",")[0]} y={p(a0 + 360 / 74, 41).split(",")[1]} fontSize="4" fill="#fff" textAnchor="middle" dominantBaseline="middle"
                    transform={`rotate(${a0 + 360 / 74 + 90} ${p(a0 + 360 / 74, 41).replace(",", " ")})`}>{n}</text>
                </g>
              );
            })}
            <circle r="26" fill="hsl(var(--panel))" stroke="#b45309" strokeWidth="1.5" />
            <text fontSize="12" fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight="800" style={{ transform: `rotate(${-angle}deg)` }}>{last ? last.state.number : ""}</text>
          </svg>
        </div>
        <div className="w-full max-w-2xl overflow-x-auto">
          <div className="grid min-w-[520px] grid-cols-[2rem_repeat(12,1fr)] gap-1">
            <Cell type="straight" value={0} label="0" className="row-span-3 bg-emerald-600" />
            {[3, 2, 1].map((row) => Array.from({ length: 12 }, (_, c) => c * 3 + row).map((n) => (
              <Cell key={n} type="straight" value={n} label={String(n)} className={cn("h-9", colour(n))} />
            )))}
          </div>
          <div className="mt-1 grid min-w-[520px] grid-cols-6 gap-1 pl-9">
            {[1, 2, 3].map((d) => <Cell key={`d${d}`} type="dozen" value={d} label={`${r.dozen} ${d}`} className="col-span-2 h-8 bg-panel-3" />)}
            <Cell type="low" label={r.low} className="h-8 bg-panel-3" />
            <Cell type="even" label={r.even} className="h-8 bg-panel-3" />
            <Cell type="red" label={r.red} className="h-8 bg-red-600" />
            <Cell type="black" label={r.black} className="h-8 bg-slate-900" />
            <Cell type="odd" label={r.odd} className="h-8 bg-panel-3" />
            <Cell type="high" label={r.high} className="h-8 bg-panel-3" />
            {[1, 2, 3].map((c) => <Cell key={`c${c}`} type="column" value={c} label={`${r.column} ${c}`} className="col-span-2 h-8 bg-panel-3" />)}
          </div>
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
