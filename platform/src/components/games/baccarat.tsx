"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { formatCredits, parseCredits } from "@/lib/money";
import { cn } from "@/lib/utils";
import { GameShell, PlayingCard, RecentStrip, ResultBanner } from "./shell";
import { useGame, type RoundView } from "./use-game";

type S = { player: number[]; banker: number[]; player_total: number; banker_total: number; winner: "player" | "banker" | "tie" };

export function BaccaratGame() {
  const { t } = useI18n();
  const b = t.casino.games.baccarat;
  const g = useGame();
  const [amounts, setAmounts] = useState({ player: "", banker: "1.00", tie: "" });
  const [last, setLast] = useState<RoundView<S> | null>(null);
  const parsed = Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.trim() === "" ? 0n : parseCredits(v)])) as Record<string, bigint | null>;
  const invalid = Object.values(parsed).some((v) => v === null);
  const total = invalid ? 0n : (parsed.player! + parsed.banker! + parsed.tie!);

  async function deal() {
    if (invalid || total <= 0n) return;
    const r = await g.call<S>("play_baccarat", { p_bets: { player: parsed.player!.toString(), banker: parsed.banker!.toString(), tie: parsed.tie!.toString() } });
    if (r) setLast(r);
  }

  return (
    <GameShell gameId="baccarat"
      controls={<>
        {(["player", "banker", "tie"] as const).map((k) => (
          <div key={k}>
            <Label>{b[k]} ({k === "player" ? "1:1" : k === "banker" ? "0.95:1" : "8:1"}) · Cr</Label>
            <Input inputMode="decimal" value={amounts[k]} placeholder="0.00" onChange={(e) => setAmounts((a) => ({ ...a, [k]: e.target.value }))} aria-invalid={parsed[k] === null} />
          </div>
        ))}
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t.casino.games.roulette.totalBet}</span><span className="font-bold">{formatCredits(total)}</span></div>
        <Button className="w-full" size="lg" onClick={deal} loading={g.busy} disabled={invalid || total <= 0n}>{b.deal}</Button>
      </>}
      stage={<div className="grid w-full max-w-2xl grid-cols-2 gap-6 p-4">
        {last && <ResultBanner status={last.status} multiplier={last.multiplier} payout={last.payout} />}
        {(["player", "banker"] as const).map((side) => (
          <div key={side} className={cn("rounded-xl border p-4 text-center", last?.state.winner === side ? "border-success bg-success/10" : "border-border")}>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide">{b[side]} {last ? `· ${last.state[`${side}_total`]}` : ""}</p>
            <div className="flex min-h-28 flex-wrap justify-center gap-1">
              {(last?.state[side] ?? []).map((c, i) => <PlayingCard key={i} card={c} small />)}
            </div>
          </div>
        ))}
        {last?.state.winner === "tie" && <p className="col-span-2 text-center font-bold text-accent">{b.tie}</p>}
      </div>}
      footer={<RecentStrip items={g.history} />}
    />
  );
}
