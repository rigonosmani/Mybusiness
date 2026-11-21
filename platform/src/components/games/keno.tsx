"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { drawn: number[]; hits: number; table: number[] };

export function KenoGame() {
  const { t } = useI18n();
  const g = useGame();
  const [picks, setPicks] = useState<number[]>([]);
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const [shown, setShown] = useState(0);
  const table = useQuery({ queryKey: ["keno-table", picks.length], enabled: picks.length > 0, queryFn: () => rpc<number[]>("keno_table", { p_picks: picks.length }) });

  useEffect(() => {
    if (!last) return;
    setShown(0);
    const id = setInterval(() => setShown((s) => (s >= 10 ? (clearInterval(id), s) : s + 1)), 120);
    return () => clearInterval(id);
  }, [last]);

  const toggle = (n: number) => {
    setLast(null);
    setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 10 ? p : [...p, n]));
  };
  const random = () => {
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const out: number[] = [];
    const k = picks.length || 10;
    const rnd = new Uint32Array(k);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < k; i++) out.push(pool.splice(rnd[i] % pool.length, 1)[0]);
    setLast(null);
    setPicks(out);
  };
  async function play() {
    const units = g.units();
    if (!units || picks.length === 0) return;
    const r = await g.call<S>("play_keno", { p_stake: units, p_picks: picks });
    if (r) setLast(r);
  }
  const drawn = new Set((last?.state.drawn ?? []).slice(0, shown));

  return (
    <GameShell gameId="keno"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy} />
        <p className="text-sm text-muted-foreground">{t.casino.games.keno.pickNumbers} · {picks.length}/10</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={random} disabled={g.busy}>{t.casino.games.keno.autoPick}</Button>
          <Button variant="secondary" onClick={() => { setPicks([]); setLast(null); }} disabled={g.busy}>{t.casino.games.keno.clear}</Button>
        </div>
        <Button className="w-full" size="lg" onClick={play} loading={g.busy} disabled={!g.stakeUnits || picks.length === 0}>{t.casino.games.keno.draw}</Button>
        {table.data && (
          <div className="grid grid-cols-4 gap-1 text-center text-xs">
            {table.data.map((m, h) => (
              <div key={h} className={cn("rounded bg-panel-2 p-1", last && shown >= 10 && last.state.hits === h && "bg-success/25")}>
                <p className="text-muted-foreground">{h} {t.casino.games.keno.hits}</p><p className="font-bold tabular-nums">{Number(m).toFixed(2)}×</p>
              </div>
            ))}
          </div>
        )}
      </>}
      stage={<div className="w-full max-w-xl p-4">
        {last && shown >= 10 && <ResultBanner status={last.status} multiplier={last.multiplier} payout={last.payout} />}
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => {
            const picked = picks.includes(n);
            const hit = drawn.has(n);
            return (
              <button key={n} onClick={() => toggle(n)} disabled={g.busy} aria-pressed={picked}
                className={cn("aspect-square rounded-md text-sm font-bold transition",
                  picked && hit && "animate-pop bg-success text-black",
                  picked && !hit && "bg-primary text-primary-foreground",
                  !picked && hit && "animate-pop bg-danger/40",
                  !picked && !hit && "bg-panel-3 hover:bg-panel-3/70")}>
                {n}
              </button>
            );
          })}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
