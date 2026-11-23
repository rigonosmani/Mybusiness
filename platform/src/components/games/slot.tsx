"use client";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Bell, Cherry, Citrus, Diamond, Gem, Grape, Hexagon, Orbit, Sparkle, Star, Heart, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { formatCredits } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Reels, useCountUp } from "./reels";
import { GameShell, RecentStrip, StakeInput } from "./shell";
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
  if (big) {
    return (
      <div className="grid size-full place-items-center rounded-xl bg-gradient-to-b from-white/10 to-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,.15)]">
        {Icon ? <Icon className={cn("size-3/5 drop-shadow-[0_0_10px_currentColor]", s.color)} strokeWidth={1.8} />
          : <span className={cn("text-[3.2rem] font-black leading-none drop-shadow-[0_0_10px_currentColor] sm:text-6xl", s.color)}>{s.text}</span>}
      </div>
    );
  }
  return Icon ? <Icon className={cn("size-5", s.color)} strokeWidth={1.8} /> : <span className={cn("text-lg font-black", s.color)}>{s.text}</span>;
}

export function SlotGame({ gameId }: { gameId: string }) {
  const { t } = useI18n();
  const g = useGame();
  const pay = useQuery({ queryKey: ["slot-pay", gameId], queryFn: () => rpc<{ id: string; line_multiplier: number }[]>("slot_paytable", { p_game_id: gameId }) });
  const ids = pay.data?.map((p) => p.id) ?? Object.keys(SYMBOLS).slice(0, 6);
  const [grid, setGrid] = useState<string[]>(() => Array.from({ length: 9 }, (_, i) => ids[i % ids.length]));
  const [spinId, setSpinId] = useState(0);
  const [target, setTarget] = useState<string[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const pending = useRef<RoundView<S> | null>(null);
  const shownWin = useCountUp(last && !spinning ? Number(last.payout) : 0, 900);

  async function spin() {
    const units = g.units();
    if (!units || spinning) return;
    setLast(null); setTarget(null); setSpinning(true); setSpinId((n) => n + 1);
    const r = await g.call<S>("play_slot", { p_game_id: gameId, p_stake: units }, { deferBalance: true });
    pending.current = r;
    setTarget(r ? r.state.grid : grid);
  }
  function landed() {
    const r = pending.current;
    setSpinning(false);
    if (!r) return;
    setGrid(r.state.grid); setLast(r); g.setBalance(r.balance);
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
      stage={<div className="w-full max-w-md p-4">
        <div className="relative rounded-2xl bg-gradient-to-b from-primary/60 via-primary/20 to-accent/50 p-1.5 shadow-[0_0_40px_hsl(var(--primary)/.35)]">
          <div className="relative grid grid-cols-3 gap-2 rounded-xl bg-gradient-to-b from-panel-3 to-background p-2 shadow-[inset_0_0_40px_rgba(0,0,0,.6)]">
            <Reels cols={3} rows={3} grid={grid} spinId={spinId} target={target} pool={ids} render={(id) => <Symbol id={id} big />}
              winning={winning} onAllStopped={landed} stagger={220} colClassName="rounded-lg bg-background/60" />
            {last && !spinning && (
              <svg viewBox="0 0 300 300" preserveAspectRatio="none" className="pointer-events-none absolute inset-2 size-[calc(100%-1rem)]" aria-hidden>
                {last.state.wins.map((w) => (
                  <polyline key={w.line} fill="none" stroke="hsl(var(--accent))" strokeWidth="5" strokeLinecap="round" pathLength={1} strokeDasharray="1"
                    style={{ animation: "line-draw .5s ease-out both", filter: "drop-shadow(0 0 6px hsl(var(--accent)))" }}
                    points={LINES[w.line].map((i) => `${Math.floor(i / 3) * 100 + 50},${(i % 3) * 100 + 50}`).join(" ")} />
                ))}
              </svg>
            )}
          </div>
        </div>
        <div className="mt-3 flex min-h-10 items-center justify-center">
          {last && !spinning && (Number(last.payout) > 0
            ? <p key={last.round_id} className="animate-[win-pop_.45s_ease-out] text-3xl font-black tabular-nums text-accent">+{formatCredits(shownWin)}</p>
            : <p className="text-sm text-muted-foreground">{t.common.lost}</p>)}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
