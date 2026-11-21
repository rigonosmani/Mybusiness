"use client";
import { Dices, Gauge, Percent, Plug, Settings, ShieldAlert, Trophy, UserCog } from "lucide-react";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/shell/admin-shell";
import { useI18n } from "@/lib/i18n";

export function SuperNav({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <AdminShell items={[
      { href: "/super", label: t.nav.dashboard, icon: Gauge, exact: true },
      { href: "/super/admins", label: t.nav.admins, icon: UserCog },
      { href: "/super/house-edge", label: t.nav.houseEdge, icon: Percent },
      { href: "/super/games", label: t.nav.games, icon: Dices },
      { href: "/super/sportsbook", label: t.nav.sportsbookOps, icon: Trophy },
      { href: "/super/integrations", label: t.nav.integrations, icon: Plug },
      { href: "/super/settings", label: t.nav.settings, icon: Settings },
      { href: "/super/security", label: t.nav.security, icon: ShieldAlert },
    ]}>{children}</AdminShell>
  );
}
