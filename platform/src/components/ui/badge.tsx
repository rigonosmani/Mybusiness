import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", {
  variants: {
    tone: {
      default: "bg-panel-3 text-muted-foreground",
      primary: "bg-primary/15 text-primary",
      success: "bg-success/15 text-success",
      danger: "bg-danger/15 text-danger",
      warning: "bg-warning/15 text-warning",
      accent: "bg-accent/15 text-accent",
    },
  },
  defaultVariants: { tone: "default" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function StatusBadge({ status, labels }: { status: string; labels?: Record<string, string> }) {
  const tone = ({ active: "success", won: "success", ok: "success", open: "primary", suspended: "warning", warning: "warning",
    lost: "danger", deactivated: "danger", error: "danger", critical: "danger", void: "default", push: "default" } as const)[status as "active"] ?? "default";
  return <Badge tone={tone}>{labels?.[status] ?? status}</Badge>;
}
