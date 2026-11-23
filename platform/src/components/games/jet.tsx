"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { formatCredits, parseCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { FlightCanvas, type FlightView } from "./flight-canvas";
import { GameShell, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { started_at: string; growth: number; cashed: (number | null)[]; crash_point?: number };
type P = { bets: { stake: number; auto: number | null }[] };
const GROWTH = 0.08;
const multAt = (sec: number) => Math.floor(Math.exp(GROWTH * Math.max(0, sec)) * 100) / 100;

interface Slip { on: boolean; stake: string; autoOn: boolean; auto: string }

export function JetGame() {
  const { t } = useI18n();
  const tj = t.casino.games.jet;
  const g = useGame();
  const [slips, setSlips] = useState<Slip[]>([
    { on: true, stake: "1.00", autoOn: false, auto: "2.00" },
    { on: false, stake: "1.00", autoOn: false, auto: "1.50" },
  ]);
  const [round, setRound] = useState<RoundView<S> | null>(null);
  const [display, setDisplay] = useState(1);
  const [history, setHistory] = useState<number[]>([]);
  const origin = useRef(0);
  const view = useRef<FlightView>({ phase: "idle", origin: 0 });
  const active = round?.status === "active";
  const params = round?.params as P | undefined;

  useEffect(() => {
    rpc<RoundView<S> | null>("get_active_round", { p_game_id: "jet" }).then((r) => r && r.state.started_at && startLocal(r)).catch(() => {});
  }, []);  

  function startLocal(r: RoundView<S>, elapsed = 0) {
    origin.current = performance.now() - elapsed * 1000;
    view.current = { phase: "flying", origin: origin.current, cashouts: [] };
    setRound(r);
  }

  useEffect(() => {
    if (!active || !round) return;
    // The canvas animates at 60 fps on its own; React only needs the value for the buttons.
    const tick = setInterval(() => setDisplay(multAt((performance.now() - origin.current) / 1000)), 100);
    const poll = setInterval(async () => {
      try {
        const s = await rpc<RoundView<S>>("jet_status", { p_round_id: round.round_id });
        if (s.status !== "active") finish(s);
        else {
          setRound((cur) => (cur ? { ...cur, state: s.state } : cur));
          syncCashouts(s.state);
          if (typeof s.elapsed === "number") {
            // Re-sync with the server clock only when drift is noticeable, so the curve never jumps.
            const o = performance.now() - s.elapsed * 1000;
            if (Math.abs(o - origin.current) > 150) { origin.current = o; view.current.origin = o; }
          }
        }
      } catch { /* transient */ }
    }, 700);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [active, round?.round_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function syncCashouts(st: S) {
    view.current.cashouts = (st.cashed ?? []).filter((x): x is number => x != null).map(Number);
  }

  function finish(r: RoundView<S>) {
    g.setBalance(r.balance);
    setRound(r);
    view.current = { ...view.current, phase: "ended", endAt: Number(r.state.crash_point ?? 1), crashed: true, endedAt: performance.now(),
      cashouts: (r.state.cashed ?? []).filter((x): x is number => x != null).map(Number) };
    if (r.state.crash_point) {
      setDisplay(Number(r.state.crash_point));
      setHistory((h) => [Number(r.state.crash_point), ...h].slice(0, 20));
    }
  }

  async function start() {
    const bets = slips.filter((s) => s.on).map((s) => ({
      stake: parseCredits(s.stake)?.toString(), auto: s.autoOn && s.auto.trim() ? Number(s.auto) : null,
    }));
    if (!bets.length || bets.some((b) => !b.stake)) return;
    const r = await g.call<S>("jet_start", { p_bets: bets });
    if (r) startLocal(r);
  }

  async function cashout(i: number) {
    if (!round) return;
    const r = await g.call<S>("jet_cashout", { p_round_id: round.round_id, p_bet: i }, { idempotent: false });
    if (!r) return;
    if (r.status !== "active") finish(r);
    else { setRound((cur) => (cur ? { ...cur, state: r.state } : cur)); syncCashouts(r.state); }
  }

  const setSlip = (i: number, patch: Partial<Slip>) => setSlips((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <GameShell gameId="jet"
      controls={<>
        {slips.map((s, i) => {
          const betIndex = params ? slips.slice(0, i + 1).filter((x) => x.on).length - 1 : -1;
          const inRound = active && s.on && params && betIndex < params.bets.length;
          const cashedAt = inRound ? round!.state.cashed?.[betIndex] : null;
          const stakeUnits = parseCredits(s.stake) ?? 0n;
          return (
            <div key={i} className={cn("space-y-2 rounded-xl border p-3", s.on ? "border-primary/40 bg-panel-2" : "border-border opacity-80")}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{i === 0 ? tj.bet1 : tj.bet2}</p>
                {i === 1 && <Switch label={tj.addSecond} checked={s.on} onCheckedChange={(v) => setSlip(1, { on: v })} disabled={active} />}
              </div>
              {s.on && <>
                <StakeInput value={s.stake} onChange={(v) => setSlip(i, { stake: v })} disabled={active || g.busy} />
                <div className="flex gap-1">
                  {["1", "2", "5", "10"].map((v) => (
                    <Button key={v} size="sm" variant="secondary" className="flex-1" disabled={active} onClick={() => setSlip(i, { stake: `${v}.00` })}>{v}</Button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <Switch label={tj.auto} checked={s.autoOn} onCheckedChange={(v) => setSlip(i, { autoOn: v })} disabled={active} />
                  <div className="flex-1">
                    <Label className="text-xs">{tj.auto}</Label>
                    <Input inputMode="decimal" value={s.auto} onChange={(e) => setSlip(i, { auto: e.target.value })} disabled={active || !s.autoOn} />
                  </div>
                </div>
                {inRound && (cashedAt != null
                  ? <p className="rounded-md bg-success/15 p-2 text-center text-sm font-bold text-success">{t.casino.games.crash.cashedOut} {Number(cashedAt).toFixed(2)}× · {formatCredits((stakeUnits * BigInt(Math.floor(Number(cashedAt) * 100))) / 100n)}</p>
                  : <Button className="w-full" size="lg" variant="accent" onClick={() => cashout(betIndex)} loading={g.busy}>
                      {tj.cashout} {formatCredits((stakeUnits * BigInt(Math.floor(display * 100))) / 100n)}
                    </Button>)}
              </>}
            </div>
          );
        })}
        {!active && <Button className="w-full" size="lg" onClick={start} loading={g.busy} disabled={!slips.some((s) => s.on)}>{tj.start}</Button>}
      </>}
      stage={<div className="relative h-[360px] w-full overflow-hidden rounded-xl sm:h-[440px]">
        <FlightCanvas view={view} sprite="jet" labels={{ flewAway: tj.flewAway, waiting: tj.waiting }} />
        <div className="absolute left-2 right-2 top-2 flex gap-1 overflow-hidden">
          {history.map((h, i) => (
            <span key={i} className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              h < 2 ? "bg-sky-500/20 text-sky-300" : h < 10 ? "bg-violet-500/20 text-violet-300" : "bg-pink-500/25 text-pink-300")}>{h.toFixed(2)}×</span>
          ))}
        </div>
        {round && round.status !== "active" && Number(round.payout) > 0 && (
          <p key={round.round_id} className="absolute inset-x-0 top-[62%] animate-[win-pop_.45s_ease-out] text-center text-2xl font-black text-success drop-shadow">+{formatCredits(round.payout)}</p>
        )}
      </div>}
    />
  );
}
