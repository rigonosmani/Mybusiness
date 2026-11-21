"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: LucideIcon; exact?: boolean }

export function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const base = href.split("?")[0];
        const active = exact ? path === base : path === base || path.startsWith(base + "/");
        return (
          <Link key={href} href={href} onClick={onNavigate}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
              active ? "bg-panel-3 text-foreground" : "text-muted-foreground hover:bg-panel-2 hover:text-foreground")}>
            <Icon className={cn("size-4", active && "text-primary")} /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
