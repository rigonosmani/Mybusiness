"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Radio, Search, Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { fetchFixtures, fetchFreshness, fetchSportsTree, isFresh } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { FixtureRow } from "./fixture-row";

export function SportsBrowser({ live }: { live?: boolean }) {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const sport = params.get("sport") ?? undefined;
  const league = params.get("league") ?? undefined;
  const [q, setQ] = useState(params.get("q") ?? "");

  const tree = useQuery({ queryKey: ["sports-tree"], queryFn: fetchSportsTree, staleTime: 300_000 });
  const fresh = useQuery({ queryKey: ["freshness"], queryFn: fetchFreshness, staleTime: 300_000 });
  const fixtures = useQuery({
    queryKey: ["fixtures", { live, sport, league, q: params.get("q") }],
    queryFn: () => fetchFixtures({ live, sport, league, q: params.get("q") ?? undefined }),
    refetchInterval: live ? 10_000 : 60_000,
  });

  const list = fixtures.data;
  const grouped = useMemo(() => {
    const g = new Map<string, NonNullable<typeof list>>();
    for (const f of list ?? []) {
      const k = f.leagues.name;
      g.set(k, [...(g.get(k) ?? []), f]);
    }
    return [...g.entries()];
  }, [list]);

  const sportName = (id: string, fallback: string) => t.sports.sportsNames[id] ?? fallback;
  const setParam = (k: string, v?: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k === "sport") p.delete("league");
    router.push(`?${p.toString()}`);
  };

  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-2">{live ? <Radio className="text-danger" /> : <Trophy className="text-primary" />} {live ? t.sports.live : t.sports.title}</span>} />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <button onClick={() => setParam("sport")} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm", !sport ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{t.sports.allSports}</button>
        {tree.data?.sports.map((s) => (
          <button key={s.id} onClick={() => setParam("sport", s.id)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm", sport === s.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {sportName(s.id, s.name)}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-col gap-3 md:flex-row">
        <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); setParam("q", q.trim() || undefined); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.sports.searchEvents} className="pl-9" aria-label={t.sports.searchEvents} />
        </form>
        {sport && (
          <select value={league ?? ""} onChange={(e) => setParam("league", e.target.value || undefined)} aria-label={t.sports.leagues}
            className="h-10 rounded-md border border-input bg-panel-2 px-3 text-sm md:w-64">
            <option value="">{t.sports.leagues}: {t.common.all}</option>
            {tree.data?.leagues.filter((l) => l.sport_id === sport).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      {live && (fixtures.data?.length ?? 0) > 0 && fresh.data && fixtures.data!.every((f) => !f.betting_markets.some((m) => m.status === "open" && isFresh(m, f, fresh.data!))) && (
        <div className="mb-4"><Notice>{t.sports.liveLocked}</Notice></div>
      )}
      {fixtures.isLoading || fresh.isLoading ? <SkeletonRows rows={6} /> :
        fixtures.error ? <ErrorState message={errorMessage(fixtures.error, t)} onRetry={() => fixtures.refetch()} retryLabel={t.common.retry} /> :
        grouped.length === 0 ? (
          <EmptyState title={live ? t.sports.noLive : t.sports.noEvents}>{(tree.data?.sports.length ?? 0) === 0 ? t.sports.notConfigured : null}</EmptyState>
        ) : (
          <div className="space-y-6">
            {grouped.map(([name, list]) => (
              <section key={name}>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  <Link href={`?league=${list[0].leagues.id}&sport=${list[0].leagues.sport_id}`} className="hover:text-foreground">{name}</Link>
                </h2>
                <div className="space-y-2">{list.map((f) => <FixtureRow key={f.id} fixture={f} freshness={fresh.data!} />)}</div>
              </section>
            ))}
          </div>
        )}
    </div>
  );
}
