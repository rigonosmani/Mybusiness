"use client";
import { BarChart3, BookOpen, Gauge, Users } from "lucide-react";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/shell/admin-shell";
import { useI18n } from "@/lib/i18n";

export function AdminNav({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <AdminShell items={[
      { href: "/admin", label: t.nav.dashboard, icon: Gauge, exact: true },
      { href: "/admin/players", label: t.nav.players, icon: Users },
      { href: "/admin/transactions", label: t.nav.transactions, icon: BookOpen },
      { href: "/admin/reports", label: t.nav.reports, icon: BarChart3 },
    ]}>{children}</AdminShell>
  );
}
