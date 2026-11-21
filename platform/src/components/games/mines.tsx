"use client";
import { useEffect, useState } from "react";
import { Bomb, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameShell, RecentStrip, ResultBanner, StakeInput } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { revealed: number[]; multiplier: number; next_multiplier?: number; mines?: number[]; hit?: number };

export function MinesGame() {
  const { t } = useI18n();
  const g = useGame();
  const [mines, setMines] = useState(3);
  const [round, setRound] = useState<RoundView<S> | null>(null);

  useEffect(() => {
    rpc<RoundView<S> | null>("get_active_round", { p_game_id: "mines" }).then((r) => r && setRound(r)).catch(() => {});
  }, []);

  const active = round?.status === "active";
  async function start() {
    const units = g.units();
    if (!units) return;
    const r = await g.call<S>("mines_start", { p_stake: units, p_mines: mines });
    if (r) setRound(r);
  }
  async function reveal(tile: number) {
    if (!active || !round || g.busy) return;
    const r = await g.call<S>("mines_reveal", { p_round_id: round.round_id, p_tile: tile }, { idempotent: false });
    if (r) setRound(r);
  }
  async function cashout() {
    if (!round) return;
    const r = await g.call<S>("mines_cashout", { p_round_id: round.round_id }, { idempotent: false });
    if (r) setRound(r);
  }

  const revealed = new Set(round?.state.revealed ?? []);
  const mineSet = new Set(round?.state.mines ?? []);
  const cur = Number(round?.state.multiplier ?? 0);
  return (
    <GameShell gameId="mines"
      controls={<>
        <StakeInput value={g.stake} onChange={g.setStake} disabled={g.busy || active} />
        <div><Label>{t.casino.games.mines.mines}</Label>
          <Select value={mines} onChange={(e) => setMines(Number(e.target.value))} disabled={active}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
        {active && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-panel-2 p-2"><dt className="text-xs text-muted-foreground">{t.common.multiplier}</dt><dd className="font-bold">{cur.toFixed(4)}×</dd></div>
            <div className="rounded-md bg-panel-2 p-2"><dt className="text-xs text-muted-foreground">{t.casino.games.mines.next}</dt><dd className="font-bold">{Number(round?.state.next_multiplier ?? 0).toFixed(4)}×</dd></div>
          </dl>
        )}
        {active ? (
          <Button className="w-full" size="lg" variant="accent" onClick={cashout} loading={g.busy} disabled={revealed.size === 0}>
            {t.casino.cashout}{round && cur > 0 ? ` · ${formatCredits(Math.floor(round.stake * cur))}` : ""}
          </Button>
        ) : (
          <Button className="w-full" size="lg" onClick={start} loading={g.busy} disabled={!g.stakeUnits}>{t.casino.games.mines.start}</Button>
        )}
      </>}
      stage={<div className="w-full max-w-md p-4">
        {round && !active && <ResultBanner status={round.status} multiplier={round.multiplier} payout={round.payout} />}
        <div className="grid grid-cols-5 gap-2" role="grid" aria-label={t.casino.games.mines.pickTile}>
          {Array.from({ length: 25 }, (_, i) => {
            const isRev = revealed.has(i);
            const isMine = mineSet.has(i);
            const ended = round && !active;
            return (
              <button key={i} onClick={() => reveal(i)} disabled={!active || isRev}
                aria-label={`${i + 1}`}
                className={cn("grid aspect-square place-items-center rounded-lg border-b-4 text-xl transition",
                  isRev && !isMine && "animate-pop border-success/40 bg-success/20",
                  isRev && isMine && "animate-pop border-danger/50 bg-danger/30",
                  !isRev && ended && isMine && "border-danger/30 bg-danger/10 opacity-70",
                  !isRev && ended && !isMine && "border-panel-3 bg-panel-3/40 opacity-60",
                  !isRev && !ended && "border-black/30 bg-panel-3 hover:-translate-y-0.5 hover:bg-panel-3/70",
                )}>
                {(isRev || ended) && (isMine ? <Bomb className="size-6 text-danger" /> : isRev ? <Gem className="size-6 text-success" /> : <Gem className="size-5 text-muted-foreground" />)}
              </button>
            );
          })}
        </div>
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
