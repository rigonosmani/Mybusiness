"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { edgeLabel, type CasinoGame } from "@/lib/casino";
import { cn } from "@/lib/utils";
import { GameArt } from "./game-art";

export function GameCard({ game, favorite, onToggleFavorite }: { game: CasinoGame; favorite: boolean; onToggleFavorite: () => void }) {
  const { t } = useI18n();
  const playable = game.enabled && game.casino_providers?.status === "active";
  const edge = edgeLabel(game);
  return (
    <div className={cn("group relative transition", playable ? "hover:-translate-y-1" : "opacity-50")}>
      {playable ? (
        <Link href={`/casino/play/${game.id}`} aria-label={`${t.casino.play} ${game.name}`}><GameArt id={game.id} name={game.name} /></Link>
      ) : (
        <div aria-disabled><GameArt id={game.id} name={game.name} /></div>
      )}
      <button onClick={onToggleFavorite} aria-pressed={favorite} aria-label={t.nav.favorites}
        className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur hover:bg-black/60">
        <Star className={cn("size-4", favorite && "fill-accent text-accent")} />
      </button>
      {game.is_new && <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">{t.casino.categories.new}</span>}
      <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
        <span className="truncate">{game.casino_providers?.name}</span>
        <span>{!playable ? t.casino.unavailable : edge ? `${t.casino.rtp} ${(100 - parseFloat(edge)).toFixed(2)}%` : ""}</span>
      </div>
    </div>
  );
}
