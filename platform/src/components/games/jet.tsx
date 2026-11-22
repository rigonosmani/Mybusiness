"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { formatCredits, parseCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { started_at: string; growth: number; cashed: (number | null)[]; crash_point?: number };
type P = { bets: { stake: number; auto: number | null }[] };
const GROWTH = 0.08;
const multAt = (sec: number) => Math.floor(Math.exp(GROWTH * Math.max(0, sec)) * 100) / 100;

interface Slip { on: boolean; stake: string; autoOn: boolean; auto: string }

function Plane({ crashed }: { crashed: boolean }) {
  return (
    <svg viewBox="0 0 64 32" className={cn("h-8 w-16 drop-shadow-[0_0_8px_rgba(255,60,60,.7)]", crashed && "opacity-90")} aria-hidden>
      <path d="M4 18 L40 14 C50 13 58 14 62 17 C58 20 50 21 40 20 L4 19Z" fill="#e11d2e" stroke="#7a0010" strokeWidth="1" />
      <path d="M26 15 L18 2 L24 2 L36 15Z M26 19 L20 30 L26 30 L35 19Z" fill="#ff3b4b" stroke="#7a0010" strokeWidth="1" />
      <path d="M6 17 L2 9 L7 9 L12 16Z" fill="#ff3b4b" stroke="#7a0010" strokeWidth="1" />
      <path d="M48 15 C52 15 56 16 58 17 L48 17Z" fill="#a7e8ff" />
      <circle cx="62" cy="17" r="2.2" fill="#ddd" className="origin-center animate-spin" />
    </svg>
  );
}

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
  const [points, setPoints] = useState<[number, number][]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const origin = useRef(0);
  const active = round?.status === "active";
  const params = round?.params as P | undefined;

  useEffect(() => {
    rpc<RoundView<S> | null>("get_active_round", { p_game_id: "jet" }).then((r) => r && r.state.started_at && startLocal(r)).catch(() => {});
  }, []);  

  function startLocal(r: RoundView<S>, elapsed = 0) {
    origin.current = performance.now() - elapsed * 1000;
    setPoints([]);
    setRound(r);
  }

  useEffect(() => {
    if (!active || !round) return;
    let raf = 0;
    const tick = () => {
      const sec = (performance.now() - origin.current) / 1000;
      const m = multAt(sec);
      setDisplay(m);
      setPoints((p) => (p.length && sec - p[p.length - 1][0] < 0.1 ? p : p.length > 4000 ? [...p.filter((_, i) => i % 2 === 0), [sec, m] as [number, number]] : [...p, [sec, m] as [number, number]]));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const poll = setInterval(async () => {
      try {
        const s = await rpc<RoundView<S>>("jet_status", { p_round_id: round.round_id });
        if (s.status !== "active") finish(s);
        else {
          setRound((cur) => (cur ? { ...cur, state: s.state } : cur));
          if (typeof s.elapsed === "number") origin.current = performance.now() - s.elapsed * 1000;
        }
      } catch { /* transient */ }
    }, 700);
    return () => { cancelAnimationFrame(raf); clearInterval(poll); };
  }, [active, round?.round_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(r: RoundView<S>) {
    g.setBalance(r.balance);
    setRound(r);
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
    else setRound((cur) => (cur ? { ...cur, state: r.state } : cur));
  }

  const crashed = !!round && round.status !== "active" && !!round.state.crash_point;
  // Chart scales grow with the flight (seconds on x, multiplier on y).
  const last = points[points.length - 1];
  const maxT = Math.max(8, last?.[0] ?? 0);
  const maxM = Math.max(2, (last?.[1] ?? display) * 1.15);
  const xy = (s: number, m: number) => [(s / maxT) * 92 + 4, 96 - ((m - 1) / (maxM - 1)) * 86];
  const path = points.map(([s, m]) => xy(s, m).join(",")).join(" ");
  const tip = last ? xy(last[0], last[1]) : [4, 96];
  const angle = points.length > 3 ? Math.atan2(-(tip[1] - xy(...points[Math.max(0, points.length - 8)])[1]), tip[0] - xy(...points[Math.max(0, points.length - 8)])[0]) : 0;
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
      stage={<div className="relative h-[380px] w-full overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_bottom,#1b2a5a,#070b1c_70%)] sm:h-[440px]">
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(1px_1px_at_20%_30%,#fff,transparent),radial-gradient(1px_1px_at_70%_20%,#fff,transparent),radial-gradient(1.5px_1.5px_at_40%_70%,#fff,transparent),radial-gradient(1px_1px_at_85%_60%,#fff,transparent),radial-gradient(1px_1px_at_10%_80%,#fff,transparent)]" />
        <div className="absolute left-2 right-2 top-2 flex gap-1 overflow-hidden">
          {history.map((h, i) => (
            <span key={i} className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              h < 2 ? "bg-sky-500/20 text-sky-300" : h < 10 ? "bg-violet-500/20 text-violet-300" : "bg-pink-500/25 text-pink-300")}>{h.toFixed(2)}×</span>
          ))}
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <linearGradient id="jetfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e11d2e" stopOpacity=".55" /><stop offset="1" stopColor="#e11d2e" stopOpacity="0" /></linearGradient>
          </defs>
          {points.length > 1 && <>
            <polygon points={`4,96 ${path} ${tip[0]},96`} fill="url(#jetfill)" opacity={crashed ? 0.3 : 1} />
            <polyline points={path} fill="none" stroke="#ff2e44" strokeWidth="1.4" vectorEffect="non-scaling-stroke" opacity={crashed ? 0.4 : 1} />
          </>}
        </svg>
        {(active || crashed) && points.length > 0 && (
          <div className={cn("absolute transition-transform", crashed && "duration-700 [transform:translate(60vw,-60vh)]")}
            style={{ left: `calc(${tip[0]}% - 32px)`, top: `calc(${tip[1]}% - 20px)` }}>
            <div style={{ transform: `rotate(${-angle * (180 / Math.PI)}deg)` }}><Plane crashed={crashed} /></div>
          </div>
        )}
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            {crashed && <p className="text-lg font-bold uppercase tracking-wider text-danger">{tj.flewAway}</p>}
            <p className={cn("text-6xl font-black tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,.6)] sm:text-7xl", crashed ? "text-danger" : "text-white")}>{display.toFixed(2)}×</p>
            {!active && !crashed && <p className="mt-2 text-sm text-muted-foreground">{tj.waiting}</p>}
            {round && round.status !== "active" && Number(round.payout) > 0 && (
              <p className="mt-2 text-xl font-bold text-success">+{formatCredits(round.payout)}</p>
            )}
          </div>
        </div>
      </div>}
    />
  );
}
