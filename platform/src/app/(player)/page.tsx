"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Radio, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/feedback";
import { Catalog } from "@/components/casino/catalog";
import { FixtureRow } from "@/components/sports/fixture-row";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { fetchFixtures, fetchFreshness } from "@/lib/sports";

export default function HomePage() {
  const { t } = useI18n();
  const p = useProfile();
  const fr = useQuery({ queryKey: ["freshness"], queryFn: fetchFreshness, staleTime: 300_000 });
  const live = useQuery({ queryKey: ["fixtures", "home-live"], queryFn: () => fetchFixtures({ live: true, limit: 5 }), refetchInterval: 15_000 });
  const upcoming = useQuery({ queryKey: ["fixtures", "home-upcoming"], queryFn: () => fetchFixtures({ limit: 6 }) });

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-panel-3 via-panel to-background p-6 sm:p-10">
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 right-40 size-64 rounded-full bg-accent/15 blur-3xl" aria-hidden />
        <div className="relative max-w-xl">
          <p className="mb-2 text-sm font-semibold text-primary">{p.display_name}</p>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl"><span className="text-gradient">Kometa</span> — {t.brand.tagline}</h1>
          <p className="mt-3 text-muted-foreground">{t.demo.hero}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild><Link href="/sports"><Trophy /> {t.nav.sports}</Link></Button>
            <Button asChild variant="secondary"><Link href="/casino/category/originals"><Sparkles /> {t.nav.originals}</Link></Button>
            <Button asChild variant="ghost"><Link href="/fairness"><ShieldCheck /> {t.nav.fairness}</Link></Button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="size-5 text-accent" /> {t.casino.categories.featured}</h2>
          <Link href="/casino" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">{t.casino.categories.all} <ArrowRight className="size-4" /></Link>
        </div>
        <Catalog category="featured" hideTabs limit={6} />
      </section>

      {(live.data?.length ?? 0) > 0 && fr.data && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Radio className="size-5 text-danger" /> {t.sports.live}</h2>
          <div className="space-y-2">{live.data!.map((f) => <FixtureRow key={f.id} fixture={f} freshness={fr.data!} />)}</div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Trophy className="size-5 text-primary" /> {t.sports.upcoming}</h2>
          <Link href="/sports" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">{t.sports.allSports} <ArrowRight className="size-4" /></Link>
        </div>
        {upcoming.isLoading || fr.isLoading ? <SkeletonRows rows={3} /> :
          (upcoming.data?.length ?? 0) === 0 ? <Card className="text-sm text-muted-foreground">{t.sports.notConfigured}</Card> :
          <div className="space-y-2">{upcoming.data!.map((f) => <FixtureRow key={f.id} fixture={f} freshness={fr.data!} />)}</div>}
      </section>
    </div>
  );
}
