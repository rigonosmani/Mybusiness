"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { fetchFavorites, fetchGames, inCategory } from "@/lib/casino";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { GameCard } from "./game-card";

const CATS = ["all", "featured", "new", "originals", "slots", "blackjack", "roulette", "baccarat", "poker", "live", "favorites"];

export function Catalog({ category = "all", limit, hideTabs }: { category?: string; limit?: number; hideTabs?: boolean }) {
  const { t } = useI18n();
  const p = useProfile();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames, staleTime: 120_000 });
  const favs = useQuery({ queryKey: ["favorites", p.id], queryFn: () => fetchFavorites(p.id) });

  const list = useMemo(() => (games.data ?? [])
    .filter((g) => inCategory(g, category, favs.data ?? new Set()))
    .filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, limit), [games.data, favs.data, category, q, limit]);

  async function toggle(id: string) {
    await rpc("toggle_favorite", { p_game_id: id });
    qc.invalidateQueries({ queryKey: ["favorites", p.id] });
  }

  return (
    <div>
      {!hideTabs && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {CATS.map((c) => (
              <Link key={c} href={c === "all" ? "/casino" : `/casino/category/${c}`}
                className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm", category === c ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                {t.casino.categories[c] ?? c}
              </Link>
            ))}
          </div>
          <div className="relative md:ml-auto md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.casino.searchGames} className="pl-9" aria-label={t.casino.searchGames} />
          </div>
        </div>
      )}
      {category === "live" && <div className="mb-4"><Notice>{t.casino.liveNotConfigured}</Notice></div>}
      {category === "slots" && <div className="mb-4"><Notice>{t.casino.externalNotConfigured}</Notice></div>}
      {games.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-6">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>
      ) : games.error ? <ErrorState message={errorMessage(games.error, t)} onRetry={() => games.refetch()} retryLabel={t.common.retry} /> :
        list.length === 0 ? <EmptyState title={t.common.empty} /> : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-6">
          {list.map((g) => <GameCard key={g.id} game={g} favorite={favs.data?.has(g.id) ?? false} onToggleFavorite={() => toggle(g.id)} />)}
        </div>
      )}
    </div>
  );
}
