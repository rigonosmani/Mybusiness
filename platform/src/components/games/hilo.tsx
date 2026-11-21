"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { GameShell, PlayingCard, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { cards: number[]; multiplier: number; fair_multiplier: number; history: { guess: string; card: number; win?: boolean }[] };

export function HiloGame({ edgeBps }: { edgeBps: number }) {
  const { t } = useI18n();
  const h = t.casino.games.hilo;
  const g = useGame();
  const [round, setRound] = useState<RoundView<S> | null>(null);
  useEffect(() => { rpc<RoundView<S> | null>("get_active_round", { p_game_id: "hilo" }).then((r) => r && setRound(r)).catch(() => {}); }, []);
  const active = round?.status === "active";
  const cards = round?.state.cards ?? [];
  const current = cards[cards.length - 1];
  const rank = current !== undefined ? (current % 13) + 1 : 7;
  const pHigh = (14 - rank) / 13, pLow = rank / 13;
  const fair = Number(round?.state.fair_multiplier ?? 1);
  const next = (p: number) => (p >= 1 ? null : Math.floor(fair / p * (1 - edgeBps / 10000) * 10000) / 10000);

  async function start() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("hilo_start", { p_stake: units });
    if (r) setRound(r);
  }
  async function guess(gs: "higher" | "lower" | "skip") {
    if (!round) return;
    const r = await g.call<S>("hilo_guess", { p_round_id: round.round_id, p_guess: gs }, { idempotent: false });
    if (r) setRound(r);
  }
  async function cashout() {
    if (!round) return;
    const r = await g.call<S>("hilo_cashout", { p_round_id: round.round_id }, { idempotent: false });
    if (r) setRound(r);
  }
  const mult = Number(round?.state.multiplier ?? 0);

  return (
    <GameShell gameId="hilo"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || active} />
        {active ? (<>
          <Button className="w-full justify-between" onClick={() => guess("higher")} disabled={g.busy || pHigh >= 1}>
            <span className="flex items-center gap-2"><ArrowUp /> {h.higher}</span><span className="tabular-nums">{next(pHigh)?.toFixed(2) ?? "—"}×</span>
          </Button>
          <Button className="w-full justify-between" variant="secondary" onClick={() => guess("lower")} disabled={g.busy || pLow >= 1}>
            <span className="flex items-center gap-2"><ArrowDown /> {h.lower}</span><span className="tabular-nums">{next(pLow)?.toFixed(2) ?? "—"}×</span>
          </Button>
          <Button className="w-full" variant="ghost" onClick={() => guess("skip")} disabled={g.busy}><SkipForward /> {h.skip}</Button>
          <Button className="w-full" size="lg" variant="accent" onClick={cashout} disabled={g.busy || mult <= 0}>
            {t.casino.cashout}{mult > 0 && round ? ` · ${formatCredits(Math.floor(round.stake * mult))}` : ""}
          </Button>
        </>) : (
          <Button className="w-full" size="lg" onClick={start} loading={g.busy} disabled={!g.stakeUnits}>{h.start}</Button>
        )}
      </>}
      stage={<div className="flex w-full flex-col items-center gap-6 p-4">
        {round && !active && <ResultBanner status={round.status} multiplier={round.multiplier} payout={round.payout} />}
        <PlayingCard card={current ?? null} hidden={current === undefined} />
        <p className="text-2xl font-extrabold tabular-nums">{mult.toFixed(2)}×</p>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {cards.slice(0, -1).map((c, i) => <PlayingCard key={i} card={c} small />)}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
