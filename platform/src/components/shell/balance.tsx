"use client";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { useProfile } from "@/components/providers";
import { useBalance } from "@/hooks/use-balance";
import { formatCredits } from "@/lib/money";
import { Skeleton } from "@/components/ui/feedback";

export function BalancePill({ href = "/wallet" }: { href?: string }) {
  const p = useProfile();
  const { data, isLoading } = useBalance(p.id);
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-1.5 text-sm font-bold tabular-nums hover:border-primary/50">
      <Wallet className="size-4 text-primary" />
      {isLoading ? <Skeleton className="h-4 w-20" /> : <span>{formatCredits(data)}</span>}
    </Link>
  );
}
