"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { fetchGames } from "@/lib/casino";
import { formatCredits, parseCredits, unitsToInput } from "@/lib/money";
import { cn } from "@/lib/utils";

export function GameShell({ gameId, controls, stage, footer, wide }: { gameId: string; controls: ReactNode; stage: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t, locale } = useI18n();
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames, staleTime: 120_000 });
  const g = games.data?.find((x) => x.id === gameId);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{g?.name ?? gameId}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="primary">{t.casino.originalDemo}</Badge>
          {g?.house_edge_settings ? (
            <Badge>{t.casino.edge} {(g.house_edge_settings.edge_bps / 100).toFixed(2)}% · {t.casino.rtp} {(100 - g.house_edge_settings.edge_bps / 100).toFixed(2)}%</Badge>
          ) : g?.fixed_edge_note ? <Badge>{t.casino.edge} · {t.casino.fixedEdge}: {g.fixed_edge_note}</Badge> : null}
          <Link href="/fairness" className="inline-flex items-center gap-1 text-primary hover:underline"><ShieldCheck className="size-3.5" /> {t.casino.fairnessShort}</Link>
        </div>
      </div>
      <div className={cn("grid gap-4", wide ? "2xl:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-[320px_minmax(0,1fr)]")}>
        <Card className="order-2 space-y-4 lg:order-1">{controls}</Card>
        <Card className="relative order-1 flex min-h-[380px] flex-col items-center justify-center overflow-hidden bg-panel-2 lg:order-2">{stage}</Card>
      </div>
      {footer}
      {g && (
        <Card className="text-sm">
          <p className="mb-1 flex items-center gap-2 font-semibold"><Info className="size-4 text-primary" /> {t.casino.rules}</p>
          <p className="text-muted-foreground">{g.description[locale] ?? g.description.en}</p>
          <p className="mt-1 text-muted-foreground">{g.rules[locale] ?? g.rules.en}</p>
        </Card>
      )}
    </div>
  );
}

export function StakeInput({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) {
  const { t } = useI18n();
  const units = parseCredits(value);
  const scale = (num: bigint, den: bigint) => {
    if (units === null) return;
    const next = (units * num) / den;
    onChange(unitsToInput(next < 1n ? 1n : next));
  };
  return (
    <div>
      <Label>{label ?? t.casino.stake} (Cr)</Label>
      <div className="flex gap-1">
        <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={units === null}
          className={cn(units === null && "border-danger")} />
        <Button type="button" variant="secondary" size="sm" className="h-10" disabled={disabled} onClick={() => scale(1n, 2n)}>{t.casino.half}</Button>
        <Button type="button" variant="secondary" size="sm" className="h-10" disabled={disabled} onClick={() => scale(2n, 1n)}>{t.casino.double}</Button>
      </div>
    </div>
  );
}

export function ProfitLine({ stakeUnits, multiplier }: { stakeUnits: bigint | null; multiplier: number }) {
  const { t } = useI18n();
  if (stakeUnits === null || !Number.isFinite(multiplier)) return null;
  // Display only: integer math on 4-decimal multiplier.
  const payout = (stakeUnits * BigInt(Math.floor(multiplier * 10000))) / 10000n;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{t.casino.profit}</span>
      <span className="font-semibold text-success tabular-nums">{formatCredits(payout - stakeUnits)}</span>
    </div>
  );
}

export function ResultBanner({ status, multiplier, payout }: { status?: string; multiplier?: number | string; payout?: number }) {
  const { t } = useI18n();
  if (!status || status === "active") return null;
  const win = status === "won" || status === "push";
  return (
    <div className={cn("absolute left-1/2 top-4 -translate-x-1/2 animate-pop rounded-lg border px-4 py-2 text-center shadow-xl",
      win ? "border-success/50 bg-success/15" : "border-danger/40 bg-danger/10")}>
      <p className={cn("text-lg font-extrabold tabular-nums", win ? "text-success" : "text-danger")}>{Number(multiplier ?? 0).toFixed(2)}×</p>
      <p className="text-xs">{win ? `${t.casino.win} ${formatCredits(payout ?? 0)}` : t.casino.lose}</p>
    </div>
  );
}

export function RecentStrip({ items }: { items: { id: string; mult: number; win: boolean }[] }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
      <span className="shrink-0 text-xs text-muted-foreground">{t.casino.recent}</span>
      {items.map((h) => (
        <span key={h.id} className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums", h.win ? "bg-success/15 text-success" : "bg-panel-3 text-muted-foreground")}>
          {h.mult.toFixed(2)}×
        </span>
      ))}
    </div>
  );
}

export function PlayingCard({ card, hidden, held, onClick, small }: { card?: number | null; hidden?: boolean; held?: boolean; onClick?: () => void; small?: boolean }) {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["♠", "♥", "♦", "♣"];
  const size = small ? "h-20 w-14 text-base" : "h-28 w-20 text-xl sm:h-32 sm:w-24";
  if (hidden || card === null || card === undefined) {
    return <div className={cn(size, "animate-pop rounded-lg border-2 border-primary/40 bg-[repeating-linear-gradient(45deg,hsl(var(--panel-3)),hsl(var(--panel-3))_6px,hsl(var(--panel-2))_6px,hsl(var(--panel-2))_12px)]")} />;
  }
  const red = Math.floor(card / 13) === 1 || Math.floor(card / 13) === 2;
  const label = `${ranks[card % 13]}${suits[Math.floor(card / 13)]}`;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} aria-label={label} aria-pressed={onClick ? held : undefined}
      className={cn(size, "relative flex animate-pop flex-col justify-between rounded-lg bg-white p-1.5 font-bold shadow-lg transition",
        red ? "text-red-600" : "text-slate-900", held && "-translate-y-2 ring-4 ring-primary")}>
      <span className="leading-none">{ranks[card % 13]}<br />{suits[Math.floor(card / 13)]}</span>
      <span className="self-center text-3xl leading-none">{suits[Math.floor(card / 13)]}</span>
      <span className="rotate-180 leading-none">{ranks[card % 13]}</span>
    </Comp>
  );
}
