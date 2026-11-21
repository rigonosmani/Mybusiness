"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/ui/card";
import { BetList } from "@/components/sports/bet-list";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { fetchBets } from "@/lib/bets";

export default function MyBetsPage() {
  const { t } = useI18n();
  const p = useProfile();
  const [tab, setTab] = useState<"open" | "settled">("open");
  const q = useQuery({ queryKey: ["bets", p.id, tab], queryFn: () => fetchBets({ userId: p.id, open: tab === "open" }), refetchInterval: 30_000 });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t.bets.title} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "settled")} className="mb-4">
        <TabsList><TabsTrigger value="open">{t.bets.open}</TabsTrigger><TabsTrigger value="settled">{t.bets.settled}</TabsTrigger></TabsList>
      </Tabs>
      <BetList query={q} />
    </div>
  );
}
