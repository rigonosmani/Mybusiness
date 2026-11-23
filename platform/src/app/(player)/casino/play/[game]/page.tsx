"use client";
import dynamic from "next/dynamic";
import { use } from "react";
import { Skeleton } from "@/components/ui/feedback";

// Games depend on the signed-in session and browser APIs (canvas, animation frames):
// render them in the browser only, instead of attempting a server render that cannot complete.
const GamePlayer = dynamic(() => import("@/components/games").then((m) => m.GamePlayer), {
  ssr: false,
  loading: () => <Skeleton className="h-[480px] w-full" />,
});

export default function PlayPage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = use(params);
  return <GamePlayer id={game} />;
}
