"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Dices, Gem, History, Home, Menu, Radio, Receipt, Scale, Search, ShieldCheck, Sparkles, Star, Trophy, User, Wallet,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { Sheet } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { BalancePill } from "./balance";
import { LocaleSwitch } from "./locale-switch";
import { NavList, type NavItem } from "./nav";
import { Notifications } from "./notifications";
import { UserMenu } from "./user-menu";
import { BetSlip, BetSlipMobileButton } from "@/components/sports/bet-slip";

export function PlayerShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");

  const items: NavItem[] = [
    { href: "/", label: t.nav.home, icon: Home, exact: true },
    { href: "/sports", label: t.nav.sports, icon: Trophy },
    { href: "/live", label: t.nav.live, icon: Radio },
    { href: "/casino", label: t.nav.casino, icon: Dices, exact: true },
    { href: "/casino/category/slots", label: t.nav.slots, icon: Gem },
    { href: "/casino/category/originals", label: t.nav.originals, icon: Sparkles },
  ];
  const account: NavItem[] = [
    { href: "/my-bets", label: t.nav.myBets, icon: Receipt },
    { href: "/wallet", label: t.nav.wallet, icon: Wallet },
    { href: "/history", label: t.nav.history, icon: History },
    { href: "/fairness", label: t.nav.fairness, icon: ShieldCheck },
    { href: "/profile", label: t.nav.profile, icon: User },
    { href: "/responsible-play", label: t.nav.responsible, icon: Scale },
  ];

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" onClick={() => setMenu(false)}><Logo /></Link>
      <NavList items={items} onNavigate={() => setMenu(false)} />
      <div>
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.nav.profile}</p>
        <NavList items={account} onNavigate={() => setMenu(false)} />
      </div>
      <p className="mt-auto px-3 text-[11px] text-muted-foreground/70">{t.demo.footnote}</p>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-border bg-panel/80 scrollbar-thin lg:block">{sidebar}</aside>
      <Sheet open={menu} onOpenChange={setMenu} title="Menu">{sidebar}</Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-3 sm:px-5">
            <button className="rounded-md p-2 hover:bg-panel-3 lg:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Menu className="size-5" /></button>
            <Link href="/" className="lg:hidden"><Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" /></Link>
            <form className="relative ml-2 hidden max-w-sm flex-1 md:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t.common.search}…`} className="h-9 pl-9" aria-label={t.common.search} />
            </form>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <Link href="/search" className="rounded-md p-2 text-muted-foreground hover:bg-panel-3 md:hidden" aria-label={t.common.search}><Search className="size-5" /></Link>
              <Link href="/casino/category/favorites" className="hidden rounded-md p-2 text-muted-foreground hover:bg-panel-3 hover:text-foreground sm:block" aria-label={t.nav.favorites}><Star className="size-5" /></Link>
              <BalancePill />
              <Notifications />
              <span className="hidden sm:block"><LocaleSwitch persist /></span>
              <UserMenu />
            </div>
          </div>
        </header>
        <div className="flex flex-1">
          <main className="min-w-0 flex-1 px-3 py-5 sm:px-6">{children}</main>
          <aside className="sticky top-[5.5rem] hidden h-[calc(100vh-5.5rem)] w-80 shrink-0 border-l border-border bg-panel/60 xl:block">
            <BetSlip />
          </aside>
        </div>
      </div>
      <BetSlipMobileButton />
    </div>
  );
}
