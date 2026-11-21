"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { GameShell, PlayingCard, RecentStrip, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { player: number[]; dealer: number[]; player_value: number; dealer_value?: number; can_double?: boolean; outcome?: string };

export function BlackjackGame() {
  const { t } = useI18n();
  const b = t.casino.games.blackjack;
  const g = useGame();
  const [round, setRound] = useState<RoundView<S> | null>(null);
  useEffect(() => { rpc<RoundView<S> | null>("get_active_round", { p_game_id: "blackjack" }).then((r) => r && setRound(r)).catch(() => {}); }, []);
  const active = round?.status === "active";

  async function deal() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("blackjack_start", { p_stake: units });
    if (r) setRound(r);
  }
  async function act(action: "hit" | "stand" | "double") {
    if (!round) return;
    const r = await g.call<S>("blackjack_action", { p_round_id: round.round_id, p_action: action }, { idempotent: false });
    if (r) setRound(r);
  }

  const dealer = round?.state.dealer ?? [];
  return (
    <GameShell gameId="blackjack"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || active} />
        {active ? (
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={() => act("hit")} loading={g.busy}>{b.hit}</Button>
            <Button variant="secondary" onClick={() => act("stand")} disabled={g.busy}>{b.stand}</Button>
            <Button variant="accent" onClick={() => act("double")} disabled={g.busy || !round?.state.can_double}>{b.double}</Button>
          </div>
        ) : (
          <Button className="w-full" size="lg" onClick={deal} loading={g.busy} disabled={!g.stakeUnits}>{b.deal}</Button>
        )}
      </>}
      stage={<div className="flex w-full flex-col items-center gap-8 p-4">
        <div className="text-center">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{b.dealer}{round?.state.dealer_value !== undefined ? ` · ${round.state.dealer_value}` : ""}</p>
          <div className="flex justify-center gap-2">
            {dealer.map((c, i) => <PlayingCard key={i} card={c} />)}
            {active && <PlayingCard hidden />}
            {!round && <><PlayingCard hidden /><PlayingCard hidden /></>}
          </div>
        </div>
        {round && !active && round.state.outcome && (
          <div className={`animate-pop rounded-lg px-4 py-2 text-lg font-extrabold ${round.status === "won" ? "bg-success/20 text-success" : round.status === "push" ? "bg-panel-3" : "bg-danger/15 text-danger"}`}>
            {b.outcomes[round.state.outcome] ?? round.state.outcome} · {Number(round.multiplier).toFixed(2)}×
          </div>
        )}
        <div className="text-center">
          <div className="flex justify-center gap-2">{(round?.state.player ?? []).map((c, i) => <PlayingCard key={i} card={c} />)}</div>
          <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">{b.you}{round ? ` · ${round.state.player_value}` : ""}</p>
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
