"use client";
import { use } from "react";
import { GamePlayer } from "@/components/games";

export default function PlayPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = use(params);
  return <GamePlayer id={game} />;
}
