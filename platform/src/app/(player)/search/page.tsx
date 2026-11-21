"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { GameArt } from "@/components/casino/game-art";
import { FixtureRow } from "@/components/sports/fixture-row";
import { useI18n } from "@/lib/i18n";
import { fetchGames } from "@/lib/casino";
import { fetchFixtures, fetchFreshness } from "@/lib/sports";
import Link from "next/link";

function SearchContent() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const games = useQuery({ queryKey: ["games"], queryFn: fetchGames, staleTime: 120_000 });
  const fixtures = useQuery({ queryKey: ["search-fixtures", q], enabled: q.length > 1, queryFn: () => fetchFixtures({ q, limit: 20 }) });
  const fr = useQuery({ queryKey: ["freshness"], queryFn: fetchFreshness, staleTime: 300_000 });
  const gameHits = (games.data ?? []).filter((g) => q && g.enabled && g.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t.common.search} />
      <form className="relative" onSubmit={(e) => { e.preventDefault(); router.push(`/search?q=${encodeURIComponent(input.trim())}`); }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} className="pl-9" placeholder={`${t.casino.searchGames} / ${t.sports.searchEvents}`} />
      </form>
      {q && gameHits.length === 0 && (fixtures.data?.length ?? 0) === 0 && !fixtures.isLoading && <EmptyState title={t.common.empty} />}
      {gameHits.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {gameHits.map((g) => <Link key={g.id} href={`/casino/play/${g.id}`}><GameArt id={g.id} name={g.name} /></Link>)}
        </div>
      )}
      {fr.data && <div className="space-y-2">{fixtures.data?.map((f) => <FixtureRow key={f.id} fixture={f} freshness={fr.data!} />)}</div>}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}
