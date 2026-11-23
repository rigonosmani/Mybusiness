"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { formatCredits } from "@/lib/money";
import { FlightCanvas, type FlightView } from "./flight-canvas";
import { GameShell, RecentStrip, StakeInput } from "./shell";
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
  const origin = useRef(0); // local performance.now() corresponding to server elapsed 0
  const view = useRef<FlightView>({ phase: "idle", origin: 0 });

  // Resume an in-progress round.
  useEffect(() => {
    rpc<RoundView<S> | null>("get_active_round", { p_game_id: "crash" }).then((r) => r && r.state.started_at && startLocal(r)).catch(() => {});
  }, []);

  function startLocal(r: RoundView<S>, serverElapsed = 0) {
    origin.current = performance.now() - serverElapsed * 1000;
    view.current = { phase: "flying", origin: origin.current };
    setRound(r);
  }

  const active = round?.status === "active";

  // Animate locally; poll the server once a second (the server decides crashes).
  useEffect(() => {
    if (!active || !round) return;
    const tick = setInterval(() => setDisplay(multAt((performance.now() - origin.current) / 1000)), 100);
    const poll = setInterval(async () => {
      try {
        const s = await rpc<RoundView<S>>("crash_status", { p_round_id: round.round_id });
        if (s.status !== "active") finish(s);
        else if (typeof s.elapsed === "number") {
          const o = performance.now() - s.elapsed * 1000;
          if (Math.abs(o - origin.current) > 150) { origin.current = o; view.current.origin = o; }
        }
      } catch { /* transient */ }
    }, 1000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [active, round?.round_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(r: RoundView<S>) {
    g.setBalance(r.balance);
    setRound(r);
    setDisplay(Number(r.state.cashed_out_at ?? r.state.crash_point ?? 1));
    view.current = { ...view.current, phase: "ended", endAt: Number(r.state.crash_point ?? 1), crashed: true, endedAt: performance.now(),
      cashouts: r.state.cashed_out_at != null ? [Number(r.state.cashed_out_at)] : [] };
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
      stage={<div className="relative h-[360px] w-full overflow-hidden rounded-xl sm:h-[420px]">
        <FlightCanvas view={view} sprite="rocket" labels={{ flewAway: t.casino.games.crash.crashed, waiting: t.casino.games.crash.start }} />
        {round && round.status === "won" && (
          <p key={round.round_id} className="absolute inset-x-0 top-[62%] animate-[win-pop_.45s_ease-out] text-center text-2xl font-black text-success drop-shadow">
            {t.casino.games.crash.cashedOut} {Number(round.state.cashed_out_at).toFixed(2)}× · +{formatCredits(round.payout)}
          </p>
        )}
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
