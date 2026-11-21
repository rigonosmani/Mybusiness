"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, Cherry, Citrus, Diamond, Gem, Grape, Hexagon, Orbit, Sparkle, Star, Heart, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { grid: string[]; wins: { line: number; symbol: string; multiplier: number }[] };
const SYMBOLS: Record<string, { icon?: LucideIcon; text?: string; color: string }> = {
  cherry: { icon: Cherry, color: "text-rose-400" }, lemon: { icon: Citrus, color: "text-yellow-300" }, plum: { icon: Grape, color: "text-violet-400" },
  bell: { icon: Bell, color: "text-amber-400" }, star: { icon: Star, color: "text-cyan-300" }, seven: { text: "7", color: "text-red-500" },
  quartz: { icon: Hexagon, color: "text-slate-200" }, topaz: { icon: Diamond, color: "text-amber-300" }, emerald: { icon: Gem, color: "text-emerald-400" },
  sapphire: { icon: Sparkle, color: "text-blue-400" }, ruby: { icon: Heart, color: "text-rose-500" }, comet: { icon: Orbit, color: "text-cyan-300" },
};
const LINES = [[0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function Symbol({ id, big }: { id: string; big?: boolean }) {
  const s = SYMBOLS[id] ?? { text: "?", color: "" };
  const Icon = s.icon;
  return Icon ? <Icon className={cn(big ? "size-10 sm:size-14" : "size-5", s.color)} strokeWidth={1.8} />
    : <span className={cn("font-black", big ? "text-4xl sm:text-6xl" : "text-lg", s.color)}>{s.text}</span>;
}

export function SlotGame({ gameId }: { gameId: string }) {
  const { t } = useI18n();
  const g = useGame();
  const pay = useQuery({ queryKey: ["slot-pay", gameId], queryFn: () => rpc<{ id: string; line_multiplier: number }[]>("slot_paytable", { p_game_id: gameId }) });
  const ids = pay.data?.map((p) => p.id) ?? Object.keys(SYMBOLS).slice(0, 6);
  const [grid, setGrid] = useState<string[]>(() => Array.from({ length: 9 }, (_, i) => ids[i % ids.length]));
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<RoundView<S> | null>(null);

  useEffect(() => {
    if (!spinning) return;
    const id = setInterval(() => setGrid(Array.from({ length: 9 }, () => ids[Math.floor(Math.random() * ids.length)])), 70);
    return () => clearInterval(id);
  }, [spinning, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  async function spin() {
    const units = g.units();
    if (!units) return;
    setLast(null);
    setSpinning(true);
    const started = Date.now();
    const r = await g.call<S>("play_slot", { p_game_id: gameId, p_stake: units });
    setTimeout(() => {
      setSpinning(false);
      if (r) { setGrid(r.state.grid); setLast(r); }
    }, Math.max(0, 700 - (Date.now() - started)));
  }
  const winning = new Set((last?.state.wins ?? []).flatMap((w) => LINES[w.line]));

  return (
    <GameShell gameId={gameId}
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || spinning} />
        <Button className="w-full" size="lg" onClick={spin} loading={g.busy || spinning} disabled={!g.stakeUnits}>{t.casino.games.slot.spin}</Button>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t.casino.games.slot.paytable}</p>
          <p className="mb-2 text-xs text-muted-foreground">{t.casino.games.slot.lines}</p>
          <div className="grid grid-cols-2 gap-1">
            {pay.data?.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-panel-2 px-2 py-1 text-sm">
                <span className="flex gap-0.5"><Symbol id={p.id} /><Symbol id={p.id} /><Symbol id={p.id} /></span>
                <span className="font-semibold tabular-nums">{(Number(p.line_multiplier) / 5).toFixed(2)}×</span>
              </div>
            ))}
          </div>
        </div>
      </>}
      stage={<div className="p-4">
        {last && <ResultBanner status={last.status} multiplier={last.multiplier} payout={last.payout} />}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border-4 border-primary/30 bg-gradient-to-b from-panel-3 to-panel p-3 shadow-[inset_0_0_40px_rgba(0,0,0,.5)]">
          {[0, 1, 2].map((row) => [0, 1, 2].map((col) => {
            const i = col * 3 + row;
            return (
              <div key={i} className={cn("grid size-20 place-items-center rounded-xl bg-background/60 sm:size-28", spinning && "blur-[1px]",
                winning.has(i) && "animate-pop ring-4 ring-accent")}>
                <Symbol id={grid[i]} big />
              </div>
            );
          }))}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
