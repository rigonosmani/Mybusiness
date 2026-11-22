"use client";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useI18n } from "@/lib/i18n";
import { fetchGames } from "@/lib/casino";
import { BaccaratGame } from "./baccarat";
import { BlackjackGame } from "./blackjack";
import { CoinflipGame } from "./coinflip";
import { CrashGame } from "./crash";
import { DiceGame } from "./dice";
import { HiloGame } from "./hilo";
import { KenoGame } from "./keno";
import { LimboGame } from "./limbo";
import { MinesGame } from "./mines";
import { PlinkoGame } from "./plinko";
import { RouletteGame } from "./roulette";
import { SlotGame } from "./slot";
import { VideoPokerGame } from "./videopoker";
import { ExternalGame } from "./external";

export function GamePlayer({ id }: { id: string }) {
  const { t } = useI18n();
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames, staleTime: 120_000 });
  if (games.isLoading) return <Skeleton className="h-[480px] w-full" />;
  const g = games.data?.find((x) => x.id === id);
  if (!g || !g.enabled || g.casino_providers?.status !== "active") return <EmptyState title={t.casino.unavailable} />;
  if (g.casino_providers?.kind !== "in_house") return <ExternalGame game={g} />;
  const edge = g.house_edge_settings?.edge_bps ?? 0;
  switch (id) {
    case "dice": return <DiceGame edgeBps={edge} />;
    case "limbo": return <LimboGame edgeBps={edge} />;
    case "coinflip": return <CoinflipGame edgeBps={edge} />;
    case "crash": return <CrashGame />;
    case "mines": return <MinesGame />;
    case "plinko": return <PlinkoGame />;
    case "keno": return <KenoGame />;
    case "roulette": return <RouletteGame />;
    case "blackjack": return <BlackjackGame />;
    case "hilo": return <HiloGame edgeBps={edge} />;
    case "baccarat": return <BaccaratGame />;
    case "videopoker": return <VideoPokerGame />;
    default: return g.category === "slots" ? <SlotGame gameId={id} /> : <EmptyState title={t.casino.unavailable} />;
  }
}
