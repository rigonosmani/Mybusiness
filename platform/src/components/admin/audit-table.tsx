"use client";
import { useQuery } from "@tanstack/react-query";
import { SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";

interface AuditRow { id: number; actor_id: string | null; actor_role: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }

/** Audit log rows visible to the caller under RLS (platform scope for the Main Admin). */
export function AuditTable({ limit = 100 }: { limit?: number }) {
  const { t, locale } = useI18n();
  const q = useQuery({
    queryKey: ["audit", limit],
    queryFn: async () => {
      const sb = supabaseBrowser();
      const { data, error } = await sb.from("audit_logs").select("*").order("id", { ascending: false }).limit(limit);
      if (error) throw error;
      const ids = [...new Set((data ?? []).flatMap((r: AuditRow) => [r.actor_id, r.target_type === "admin" ? r.target_id : null]).filter(Boolean))] as string[];
      const { data: names } = ids.length ? await sb.from("profiles").select("id, username").in("id", ids) : { data: [] };
      const map = new Map((names ?? []).map((n: { id: string; username: string }) => [n.id, n.username]));
      return (data as AuditRow[]).map((r) => ({ ...r, actor: map.get(r.actor_id ?? "") ?? r.actor_role ?? "system", target: map.get(r.target_id ?? "") ?? r.target_id }));
    },
  });
  if (q.isLoading) return <SkeletonRows rows={5} />;
  return (
    <Table>
      <THead><tr><TH>{t.common.time}</TH><TH>{t.super.security.actor}</TH><TH>{t.super.security.action}</TH><TH>{t.super.security.target}</TH><TH>{t.common.details}</TH></tr></THead>
      <TBody>
        {q.data?.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at, locale)}</TD>
            <TD>{r.actor}</TD>
            <TD className="font-mono text-xs">{r.action}</TD>
            <TD className="max-w-[10rem] truncate text-xs">{r.target_type}{r.target ? `: ${r.target}` : ""}</TD>
            <TD className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
