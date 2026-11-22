"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Info, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { CascadeSymbol } from "./cascade-symbols";
import { GameShell, RecentStrip, StakeInput } from "./shell";
import { useGame } from "./use-game";

interface Step { grid: string[]; winners: string[]; win: number }
interface Spin { steps: Step[]; final: string[]; win: number; scatters: number; orbs: number; free: boolean }
interface S { spins: Spin[]; raw: number; scale: number; scatter_win: number; free_spins: number }
interface Paytable { scale: number; symbols: { id: string; pays: [number, number, number] }[]; scatter: { pays: Record<string, number> }; max_win: number }

const COLS = 6, ROWS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDLE = ["gem_blue", "gem_violet", "nova", "gem_green", "rocket", "gem_amber", "helmet", "gem_red", "ringed", "gem_blue", "blackhole", "gem_green",
  "gem_amber", "rocket", "gem_violet", "nova", "gem_red", "gem_blue", "ringed", "gem_green", "helmet", "gem_amber", "gem_violet", "gem_red",
  "gem_blue", "helmet", "gem_green", "rocket", "gem_amber", "ringed"];

export function CascadeGame({ gameId }: { gameId: string }) {
  const { t, locale } = useI18n();
  const g = useGame("1.00");
  const pay = useQuery({ queryKey: ["cascade-pay", gameId], queryFn: () => rpc<Paytable>("cascade_paytable", { p_game_id: gameId }) });
  const [grid, setGrid] = useState<string[]>(IDLE);
  const [dropKey, setDropKey] = useState(0);
  const [winners, setWinners] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(0); // credits won so far (units)
  const [fs, setFs] = useState<{ n: number; total: number } | null>(null);
  const [mult, setMult] = useState<number | null>(null);
  const [big, setBig] = useState<{ label: string; amount: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const [rules, setRules] = useState(false);
  const skip = useRef(false);

  useEffect(() => () => { skip.current = true; }, []);

  async function play() {
    const units = g.units();
    if (!units || animating) return;
    skip.current = false;
    setBig(null); setShown(0); setFs(null); setMult(null); setWinners(new Set());
    setAnimating(true);
    const r = await g.call<S>("play_cascade", { p_game_id: gameId, p_stake: units }, { deferBalance: true });
    if (!r) { setAnimating(false); return; }
    const unitStake = Number(units);
    const scale = Number(r.state.scale);
    const speed = () => (skip.current ? 0 : 1);
    let acc = 0;
    for (let i = 0; i < r.state.spins.length; i++) {
      const sp = r.state.spins[i];
      if (sp.free) setFs({ n: i, total: r.state.spins.length - 1 });
      const frames = [...sp.steps.map((s) => s.grid), sp.final];
      for (let k = 0; k < frames.length; k++) {
        setGrid(frames[k]); setDropKey((d) => d + 1); setWinners(new Set());
        await sleep(420 * speed());
        const step = sp.steps[k];
        if (step) {
          setWinners(new Set(step.winners));
          acc += Math.floor(step.win * scale * unitStake);
          setShown(acc);
          await sleep(650 * speed());
        }
      }
      if (sp.free && sp.win > 0 && sp.orbs > 0) {
        setMult(sp.orbs);
        const before = sp.steps.reduce((a, s) => a + s.win, 0);
        acc += Math.floor((sp.win - before) * scale * unitStake);
        setShown(acc);
        await sleep(900 * speed());
        setMult(null);
      }
      if (i === 0 && r.state.free_spins > 0) {
        if (r.state.scatter_win > 0) { acc += Math.floor(r.state.scatter_win * scale * unitStake); setShown(acc); }
        setFs({ n: 0, total: r.state.free_spins });
        await sleep(1400 * speed());
      }
    }
    setShown(r.payout);
    g.setBalance(r.balance);
    const m = Number(r.multiplier);
    if (m >= 10) setBig({ label: m >= 100 ? "EPIC WIN" : m >= 50 ? "MEGA WIN" : m >= 20 ? "SUPER WIN" : "BIG WIN", amount: r.payout });
    setFs(null);
    setAnimating(false);
  }

  const scale = pay.data ? Number(pay.data.scale) : 0;
  return (
    <GameShell gameId={gameId} wide
      controls={<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1"><StakeInput value={g.stake} onChange={g.setStake} disabled={animating} /></div>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-12" onClick={() => setRules(true)} aria-label={t.casino.games.slot.paytable}><Info /></Button>
          {animating
            ? <Button className="h-12 flex-1 sm:w-48" variant="accent" onClick={() => { skip.current = true; }}><Zap /> Skip</Button>
            : <Button className="h-12 flex-1 sm:w-48" size="lg" onClick={play} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.slot.spin}</Button>}
        </div>
      </div>}
      stage={<div className="relative w-full select-none p-2 sm:p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,85,247,.35),transparent_55%),radial-gradient(circle_at_10%_90%,rgba(34,211,238,.25),transparent_50%)]" aria-hidden />
        <div className="relative mb-2 flex items-center justify-between px-1 text-sm">
          <span className="font-extrabold tracking-wide text-gradient">COSMIC CASCADE</span>
          {fs ? <span className="rounded-full bg-fuchsia-500/20 px-3 py-1 font-bold text-fuchsia-200"><Sparkles className="mr-1 inline size-4" />FREE SPINS {fs.n}/{fs.total}</span>
            : <span className="text-xs text-muted-foreground">8+ = WIN · 4× ◉ = FREE SPINS</span>}
        </div>
        <div className="relative mx-auto grid max-w-2xl grid-cols-6 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1.5 shadow-[inset_0_0_60px_rgba(0,0,0,.6)] sm:gap-1.5 sm:p-2">
          {Array.from({ length: COLS }, (_, c) => (
            <div key={c} className="grid grid-rows-5 gap-1 sm:gap-1.5">
              {Array.from({ length: ROWS }, (_, r) => {
                const cell = grid[c * ROWS + r];
                const win = winners.has(cell);
                return (
                  <div key={`${dropKey}-${r}`}
                    className={cn("relative aspect-square rounded-lg bg-white/[.04] p-1 sm:p-1.5",
                      animating && "animate-[cascade-drop_.35s_ease-out_both]",
                      win && "animate-[cascade-win_.6s_ease-in-out_infinite] bg-amber-300/20 ring-2 ring-amber-300")}
                    style={animating ? { animationDelay: `${r * 35}ms` } : undefined}>
                    <CascadeSymbol cell={cell} />
                  </div>
                );
              })}
            </div>
          ))}
          {mult !== null && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="animate-pop text-6xl font-black text-white drop-shadow-[0_0_20px_rgba(244,114,182,.9)]">×{mult}</span>
            </div>
          )}
          {big && (
            <button className="absolute inset-0 grid place-items-center rounded-2xl bg-black/60 backdrop-blur-sm" onClick={() => setBig(null)}>
              <div className="animate-pop text-center">
                <p className="bg-gradient-to-b from-yellow-200 to-orange-500 bg-clip-text text-4xl font-black text-transparent sm:text-6xl">{big.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-white sm:text-4xl">{formatCredits(big.amount)}</p>
              </div>
            </button>
          )}
        </div>
        <div className="relative mt-3 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t.casino.win}</p>
          <p className={cn("text-2xl font-extrabold tabular-nums", shown > 0 ? "text-success" : "text-muted-foreground")}>{formatCredits(shown)}</p>
        </div>
      </div>}
      footer={<>
        <RecentStrip items={g.history} />
        <Dialog open={rules} onOpenChange={setRules} title={t.casino.games.slot.paytable} className="max-w-lg">
          <p className="mb-3 text-sm text-muted-foreground">{locale === "sq"
            ? "8 ose më shumë simbole të njëjta kudo në ekran fitojnë. Simbolet fituese zhduken dhe bien të reja – fitimet vazhdojnë. Pagesat janë shumëfish i bastit."
            : "8 or more matching symbols anywhere win. Winning symbols vanish and new ones fall – wins keep coming. Pays are multiples of the stake."}</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {pay.data?.symbols.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md bg-panel-2 p-1.5 text-xs">
                <div className="size-9 shrink-0"><CascadeSymbol cell={s.id} /></div>
                <div className="grid flex-1 grid-cols-3 text-center tabular-nums">
                  {(["8-9", "10-11", "12+"] as const).map((lbl, i) => (
                    <div key={lbl}><p className="text-muted-foreground">{lbl}</p><p className="font-bold">{(s.pays[i] * scale).toFixed(2)}×</p></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-md bg-panel-2 p-2 text-xs">
            <div className="size-10 shrink-0"><CascadeSymbol cell="blackhole" /></div>
            <p>{locale === "sq" ? "4+ vrima të zeza: 10 rrotullime falas" : "4+ black holes: 10 free spins"} · 4 = {((pay.data?.scatter.pays["4"] ?? 0) * scale).toFixed(1)}× · 5 = {((pay.data?.scatter.pays["5"] ?? 0) * scale).toFixed(1)}× · 6 = {((pay.data?.scatter.pays["6"] ?? 0) * scale).toFixed(0)}×. {locale === "sq" ? "3+ gjatë rrotullimeve falas: +5." : "3+ during free spins: +5."}</p>
          </div>
          <div className="mt-2 flex items-center gap-3 rounded-md bg-panel-2 p-2 text-xs">
            <div className="size-10 shrink-0"><CascadeSymbol cell="orb:25" /></div>
            <p>{locale === "sq" ? "Yjet shumëzues (2×–100×) bien vetëm në rrotullimet falas; nëse rrotullimi fiton, fitimi shumëzohet me shumën e tyre." : "Star orbs (2×–100×) land only in free spins; if the spin wins, its win is multiplied by their total."} Max {pay.data?.max_win ?? 5000}×.</p>
          </div>
        </Dialog>
      </>}
    />
  );
}
