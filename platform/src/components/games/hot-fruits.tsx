"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchGames } from "@/lib/casino";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { FRUIT_IDS, FruitSymbol } from "./fruit-symbols";
import { CoinBurst, Reels, useCountUp } from "./reels";
import { GameShell, RecentStrip, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type Win = { line: number | null; symbol: string; count: number; multiplier: number };
type S = { grid: string[]; wins: Win[] };
type Paytable = { symbols: { id: string; pays: Record<string, number> }[]; scatter: { id: string; pays: Record<string, number> }; lines: number[][]; rtp: number };

const LINE_COLORS = ["#ffd400", "#00e1ff", "#ff3df2", "#4dff6a", "#ff7a00"];
const MAX_GAMBLE = 5;
const randomGrid = () => Array.from({ length: 15 }, () => FRUIT_IDS[Math.floor(Math.random() * FRUIT_IDS.length)]);

export function HotFruitsGame({ gameId }: { gameId: string }) {
  const { t } = useI18n();
  const tf = t.casino.games.fruits;
  const g = useGame();
  const pay = useQuery({ queryKey: ["lines-pay", gameId], queryFn: () => rpc<Paytable>("lines_paytable", { p_game_id: gameId }) });
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames, staleTime: 120_000 });
  const coinEdge = games.data?.find((x) => x.id === "coinflip")?.house_edge_settings?.edge_bps ?? 100;
  const gambleMult = Math.floor(2 * (1 - coinEdge / 10000) * 10000) / 10000;

  const [grid, setGrid] = useState<string[]>(randomGrid);
  const [spinId, setSpinId] = useState(0);
  const [target, setTarget] = useState<string[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [win, setWin] = useState(0);              // current collectable win (units)
  const [gamble, setGamble] = useState<{ step: number; card: null | { color: "red" | "black"; suit: string }; lost: boolean } | null>(null);
  const pending = useRef<RoundView<S> | null>(null);
  const shownWin = useCountUp(last && !spinning ? Number(last.payout) : 0, 1000);

  async function spin() {
    const units = g.units();
    if (!units || spinning) return;
    setLast(null); setGamble(null); setWin(0); setTarget(null);
    setSpinning(true);
    setSpinId((n) => n + 1);
    const r = await g.call<S>("play_lines", { p_game_id: gameId, p_stake: units }, { deferBalance: true });
    pending.current = r;
    setTarget(r ? r.state.grid : grid); // on error the reels land back where they were
  }

  function landed() {
    const r = pending.current;
    setSpinning(false);
    if (!r) return;
    setGrid(r.state.grid);
    setLast(r);
    setWin(Number(r.payout));
    g.setBalance(r.balance);
  }

  async function pick(color: "red" | "black") {
    if (!gamble || win <= 0) return;
    const r = await g.call<{ result: "heads" | "tails"; win: boolean }>("play_coinflip", { p_stake: String(win), p_side: color === "red" ? "heads" : "tails" });
    if (!r) return;
    const c: "red" | "black" = r.state.result === "heads" ? "red" : "black";
    const suit = c === "red" ? (Math.random() < 0.5 ? "♥" : "♦") : (Math.random() < 0.5 ? "♠" : "♣");
    const won = r.status === "won";
    setGamble({ step: gamble.step + 1, card: { color: c, suit }, lost: !won });
    setWin(won ? Number(r.payout) : 0);
  }

  const lines = useMemo(() => pay.data?.lines ?? [], [pay.data]);
  const winCells = useMemo(() => {
    const s = new Set<number>();
    for (const w of last?.state.wins ?? []) {
      if (w.line === null) last!.state.grid.forEach((x, i) => x === w.symbol && s.add(i));
      else lines[w.line]?.slice(0, w.count).forEach((i) => s.add(i));
    }
    return s;
  }, [last, lines]);
  const stake = g.stakeUnits ?? 0n;
  const amount = (mult: number, perLine: boolean) => formatCredits((stake * BigInt(Math.floor(mult * 10000))) / (perLine ? 50000n : 10000n), { suffix: false });
  const canGamble = !!last && win > 0 && !spinning && (!gamble || (!gamble.lost && gamble.step < MAX_GAMBLE));

  return (
    <GameShell gameId={gameId}
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || spinning || !!gamble} />
        {gamble && !gamble.lost && win > 0 ? (
          <Button className="w-full" size="lg" variant="accent" onClick={() => setGamble(null)}>{tf.collect} · {formatCredits(win)}</Button>
        ) : (
          <Button className="w-full" size="lg" onClick={spin} loading={g.busy || spinning} disabled={!g.stakeUnits}>{tf.spin}</Button>
        )}
        {canGamble && !gamble && <Button className="w-full" variant="secondary" onClick={() => setGamble({ step: 0, card: null, lost: false })}>{tf.gamble} ×{gambleMult}</Button>}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t.casino.games.slot.paytable}</p>
          <p className="mb-2 text-xs text-muted-foreground">{tf.lines}</p>
          <div className="space-y-1">
            {pay.data?.symbols.slice().reverse().map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded bg-panel-2 px-2 py-1 text-xs">
                <span className="size-7 shrink-0"><FruitSymbol id={s.id} /></span>
                <span className="grid flex-1 grid-cols-4 gap-x-2 tabular-nums">
                  {["2", "3", "4", "5"].map((k) => (
                    <span key={k} className="flex flex-col leading-tight">
                      <span className="text-[10px] text-muted-foreground">{s.pays[k] ? `${k}×` : ""}</span>
                      <span className="font-semibold">{s.pays[k] ? amount(Number(s.pays[k]), true) : ""}</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {pay.data && (
              <div className="flex items-center gap-2 rounded bg-panel-2 px-2 py-1 text-xs">
                <span className="size-7 shrink-0"><FruitSymbol id="star" /></span>
                <span className="grid flex-1 grid-cols-4 gap-x-2 tabular-nums">
                  <span />
                  {["3", "4", "5"].map((k) => (
                    <span key={k} className="flex flex-col leading-tight">
                      <span className="text-[10px] text-muted-foreground">{k}{k === "5" ? "+" : ""}×</span>
                      <span className="font-semibold">{amount(Number(pay.data.scatter.pays[k]), false)}</span>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {pay.data && <p className="pt-1 text-[11px] text-muted-foreground">{tf.scatter} · Cr · RTP {pay.data.rtp}%</p>}
          </div>
        </div>
      </>}
      stage={<div className="w-full max-w-2xl p-2 sm:p-4">
        <div className={cn("relative rounded-2xl bg-gradient-to-b from-[#ffcf4a] via-[#ff7a00] to-[#b30000] p-1.5 shadow-[0_0_40px_rgba(255,90,0,.45)]",
          last && Number(last.payout) > 0 && !spinning && "animate-[frame-glow_1.2s_ease-in-out_3]")}>
          <div className="relative rounded-xl bg-[radial-gradient(ellipse_at_top,#4a0b00,#140200_70%)] p-2 sm:p-3">
            <div className="relative grid grid-cols-5 gap-1.5 sm:gap-2">
              <Reels cols={5} rows={3} grid={grid} spinId={spinId} target={target} pool={FRUIT_IDS} render={(id) => <FruitSymbol id={id} />}
                winning={winCells} onAllStopped={landed}
                colClassName="rounded-lg bg-gradient-to-b from-[#2a0600] via-[#4a0d00] to-[#2a0600] shadow-[inset_0_0_14px_rgba(0,0,0,.85)]" />
              {last && !spinning && (
                <svg viewBox="0 0 500 300" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                  {last.state.wins.filter((w) => w.line !== null).map((w) => (
                    <polyline key={w.line} fill="none" stroke={LINE_COLORS[w.line!]} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" opacity=".9"
                      pathLength={1} strokeDasharray="1" style={{ animation: "line-draw .55s ease-out both", filter: `drop-shadow(0 0 6px ${LINE_COLORS[w.line!]})` }}
                      points={lines[w.line!].map((i) => `${Math.floor(i / 3) * 100 + 50},${(i % 3) * 100 + 50}`).join(" ")} />
                  ))}
                </svg>
              )}
            </div>
            {last && !spinning && Number(last.payout) >= Number(last.stake) * 10 && (
              <div key={last.round_id} className="pointer-events-none absolute inset-0 grid place-items-center">
                <CoinBurst />
                <p className="animate-[win-pop_.6s_ease-out] rounded-xl bg-black/60 px-5 py-2 text-3xl font-black uppercase tracking-wide text-amber-300 drop-shadow-[0_0_18px_rgba(255,200,0,.9)] sm:text-5xl">
                  {Number(last.payout) >= Number(last.stake) * 50 ? "MEGA WIN" : "BIG WIN"}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex min-h-12 items-center justify-center text-center">
          {last && !spinning && !gamble && (Number(last.payout) > 0
            ? <p key={last.round_id} className="animate-[win-pop_.45s_ease-out] text-3xl font-black tabular-nums text-amber-300 drop-shadow-[0_0_12px_rgba(255,200,0,.6)]">{tf.win} {formatCredits(shownWin)}</p>
            : <p className="text-sm text-muted-foreground">{t.common.lost}</p>)}
        </div>
        {gamble && (
          <div className="mx-auto mt-2 max-w-sm rounded-xl border border-amber-400/40 bg-black/40 p-4 text-center">
            <p className="mb-3 text-sm text-muted-foreground">{gamble.lost ? "" : tf.pick.replace("{m}", String(gambleMult))}</p>
            <div className={cn("mx-auto mb-3 grid h-32 w-24 place-items-center rounded-lg border-2 text-5xl font-black shadow-lg",
              gamble.card ? "border-white bg-white" : "border-amber-300 bg-[repeating-linear-gradient(45deg,#7a0000,#7a0000_6px,#b30000_6px,#b30000_12px)]",
              gamble.card?.color === "red" ? "text-red-600" : "text-black")}>
              {gamble.card?.suit ?? ""}
            </div>
            <p className={cn("mb-3 text-lg font-bold tabular-nums", gamble.lost ? "text-danger" : "text-amber-300")}>{formatCredits(win)}</p>
            {!gamble.lost && gamble.step < MAX_GAMBLE && win > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <Button className="bg-red-600 text-white hover:bg-red-500" onClick={() => pick("red")} loading={g.busy}>{tf.red}</Button>
                <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => pick("black")} loading={g.busy}>{tf.black}</Button>
              </div>
            ) : !gamble.lost ? <p className="text-xs text-muted-foreground">{tf.maxSteps}</p> : null}
          </div>
        )}
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
