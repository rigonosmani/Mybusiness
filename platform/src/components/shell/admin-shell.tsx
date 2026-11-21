"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand";
import { Sheet } from "@/components/ui/dialog";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";
import { BalancePill } from "./balance";
import { LocaleSwitch } from "./locale-switch";
import { NavList, type NavItem } from "./nav";
import { UserMenu } from "./user-menu";

export function AdminShell({ items, children }: { items: NavItem[]; children: ReactNode }) {
  const { t } = useI18n();
  const p = useProfile();
  const [menu, setMenu] = useState(false);
  const home = p.role === "super_admin" ? "/super" : "/admin";
  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href={home} onClick={() => setMenu(false)}><Logo /></Link>
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {p.role === "super_admin" ? t.nav.mainAdminArea : t.nav.adminArea}
      </p>
      <NavList items={items} onNavigate={() => setMenu(false)} />
      <p className="mt-auto rounded-lg border border-border bg-panel-2 p-3 text-xs text-muted-foreground">{t.demo.banner}</p>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-border bg-panel/80 lg:block">{sidebar}</aside>
      <Sheet open={menu} onOpenChange={setMenu} title="Menu">{sidebar}</Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-6">
          <button className="rounded-md p-2 hover:bg-panel-3 lg:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Menu className="size-5" /></button>
          <div className="ml-auto flex items-center gap-2">
            <BalancePill href={home} />
            <LocaleSwitch persist />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-3 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
