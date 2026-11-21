"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { started_at: string; growth: number; crash_point?: number; cashed_out_at?: number | null };
const GROWTH = 0.08;
const multAt = (sec: number) => Math.floor(Math.exp(GROWTH * Math.max(0, sec)) * 100) / 100;

export function CrashGame() {
  const { t } = useI18n();
  const g = useGame();
  const [auto, setAuto] = useState("");
  const [round, setRound] = useState<RoundView<S> | null>(null);
  const [display, setDisplay] = useState(1);
  const [points, setPoints] = useState<number[]>([]);
  const origin = useRef(0); // local performance.now() corresponding to server elapsed 0

  // Resume an in-progress round.
  useEffect(() => {
    rpc<RoundView<S> | null>("get_active_round", { p_game_id: "crash" }).then((r) => r && r.state.started_at && startLocal(r)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startLocal(r: RoundView<S>, serverElapsed = 0) {
    origin.current = performance.now() - serverElapsed * 1000;
    setPoints([]);
    setRound(r);
  }

  const active = round?.status === "active";

  // Animate locally; poll the server once a second (the server decides crashes).
  useEffect(() => {
    if (!active || !round) return;
    let raf = 0;
    const tick = () => {
      const sec = (performance.now() - origin.current) / 1000;
      const m = multAt(sec);
      setDisplay(m);
      setPoints((p) => (p.length && p[p.length - 1] === m ? p : [...p, m].slice(-400)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const poll = setInterval(async () => {
      try {
        const s = await rpc<RoundView<S>>("crash_status", { p_round_id: round.round_id });
        if (s.status !== "active") finish(s);
        else if (typeof s.elapsed === "number") origin.current = performance.now() - s.elapsed * 1000;
      } catch { /* transient */ }
    }, 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(poll); };
  }, [active, round?.round_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(r: RoundView<S>) {
    g.setBalance(r.balance);
    setRound(r);
    setDisplay(Number(r.state.cashed_out_at ?? r.state.crash_point ?? 1));
  }

  async function start() {
    const units = g.units();
    if (!units) return;
    const a = auto.trim() ? Number(auto) : null;
    const r = await g.call<S>("crash_start", { p_stake: units, p_auto_cashout: a });
    if (r) startLocal(r);
  }
  async function cashout() {
    if (!round) return;
    const r = await g.call<S>("crash_cashout", { p_round_id: round.round_id }, { idempotent: false });
    if (r) finish(r);
  }

  const crashed = round && round.status !== "active" && round.state.cashed_out_at == null;
  const max = Math.max(2, ...points);
  const path = points.map((m, i) => `${(i / Math.max(1, points.length - 1)) * 100},${100 - ((m - 1) / (max - 1)) * 90}`).join(" ");

  return (
    <GameShell gameId="crash"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || active} />
        <div><Label>{t.casino.games.crash.autoCashout}</Label><Input inputMode="decimal" placeholder="2.00" value={auto} onChange={(e) => setAuto(e.target.value)} disabled={active} /></div>
        {active ? (
          <Button className="w-full" size="lg" variant="accent" onClick={cashout} loading={g.busy}>{t.casino.cashout} · {display.toFixed(2)}×</Button>
        ) : (
          <Button className="w-full" size="lg" onClick={start} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.crash.start}</Button>
        )}
      </>}
      stage={<>
        {round && round.status !== "active" && <ResultBanner status={round.status} multiplier={round.multiplier} payout={round.payout} />}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full p-6" aria-hidden>
          <polyline points={path} fill="none" stroke={crashed ? "hsl(var(--danger))" : "hsl(var(--primary))"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="relative text-center">
          <p className={cn("text-7xl font-extrabold tabular-nums", crashed ? "text-danger" : round?.status === "won" ? "text-success" : "text-foreground")}>{display.toFixed(2)}×</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {active ? t.casino.games.crash.flying : crashed ? `${t.casino.games.crash.crashed} ${Number(round?.state.crash_point).toFixed(2)}×`
              : round ? `${t.casino.games.crash.cashedOut} ${Number(round.state.cashed_out_at).toFixed(2)}× · ${t.casino.games.crash.crashed} ${Number(round.state.crash_point).toFixed(2)}×` : ""}
          </p>
        </div>
      </>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
