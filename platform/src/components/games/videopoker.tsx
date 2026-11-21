"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, PlayingCard, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { hand: number[]; hand_rank: string; pays?: number };
const PAYS: [string, number][] = [["royal_flush", 800], ["straight_flush", 50], ["four_of_a_kind", 25], ["full_house", 9], ["flush", 6], ["straight", 4], ["three_of_a_kind", 3], ["two_pair", 2], ["jacks_or_better", 1]];

export function VideoPokerGame() {
  const { t } = useI18n();
  const v = t.casino.games.videopoker;
  const g = useGame();
  const [round, setRound] = useState<RoundView<S> | null>(null);
  const [hold, setHold] = useState([false, false, false, false, false]);
  useEffect(() => { rpc<RoundView<S> | null>("get_active_round", { p_game_id: "videopoker" }).then((r) => r && setRound(r)).catch(() => {}); }, []);
  const active = round?.status === "active";

  async function deal() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("videopoker_deal", { p_stake: units });
    if (r) { setRound(r); setHold([false, false, false, false, false]); }
  }
  async function draw() {
    if (!round) return;
    const r = await g.call<S>("videopoker_draw", { p_round_id: round.round_id, p_hold: hold }, { idempotent: false });
    if (r) setRound(r);
  }
  const rank = round?.state.hand_rank;

  return (
    <GameShell gameId="videopoker"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || active} />
        {active ? <Button className="w-full" size="lg" onClick={draw} loading={g.busy}>{v.draw}</Button>
          : <Button className="w-full" size="lg" onClick={deal} loading={g.busy} disabled={!g.stakeUnits}>{v.deal}</Button>}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{v.paytable}</p>
          <table className="w-full text-sm">
            <tbody>
              {PAYS.map(([k, p]) => (
                <tr key={k} className={cn(rank === k && "bg-success/15 font-bold text-success")}>
                  <td className="py-0.5">{v.hands[k]}</td><td className="text-right tabular-nums">{p}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      stage={<div className="flex flex-col items-center gap-6 p-4">
        {round && !active && <ResultBanner status={round.status} multiplier={round.multiplier} payout={round.payout} />}
        <div className="flex flex-wrap justify-center gap-2">
          {(round?.state.hand ?? [null, null, null, null, null]).map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <PlayingCard card={c} hidden={c === null} held={active && hold[i]} onClick={active ? () => setHold((h) => h.map((x, j) => (j === i ? !x : x))) : undefined} />
              <span className={cn("text-[11px] font-bold uppercase", active && hold[i] ? "text-primary" : "text-transparent")}>{v.hold}</span>
            </div>
          ))}
        </div>
        {rank && <p className="text-lg font-bold">{v.hands[rank] ?? rank}</p>}
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
