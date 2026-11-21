"use client";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AuditTable } from "@/components/admin/audit-table";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

interface Ev { id: number; event_type: string; severity: string; created_at: string; subject_role: string | null; subject: string | null; tenant: string | null; details: Record<string, unknown> }

export default function SecurityPage() {
  const { t, locale } = useI18n();
  const s = t.super.security;
  const events = useQuery({ queryKey: ["security-events"], queryFn: () => rpc<Ev[]>("list_security_events", { p_limit: 200 }), refetchInterval: 60_000 });
  return (
    <div className="space-y-6">
      <PageHeader title={s.title} />
      <Card>
        <CardHeader title={s.events} />
        {events.isLoading ? <SkeletonRows /> : (
          <Table>
            <THead><tr><TH>{t.common.time}</TH><TH>{s.severity}</TH><TH>{t.common.type}</TH><TH>{s.target}</TH><TH>{t.common.details}</TH></tr></THead>
            <TBody>
              {events.data?.length === 0 && <tr><TD colSpan={5} className="text-center text-muted-foreground">{t.common.empty}</TD></tr>}
              {events.data?.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at, locale)}</TD>
                  <TD><StatusBadge status={e.severity === "info" ? "void" : e.severity} /></TD>
                  <TD className="font-mono text-xs">{e.event_type}</TD>
                  <TD className="text-xs">{e.subject ?? (e.subject_role ? `${e.subject_role}${e.tenant ? ` @${e.tenant}` : ""}` : "—")}</TD>
                  <TD className="max-w-xs truncate font-mono text-xs text-muted-foreground">{JSON.stringify(e.details)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card><CardHeader title={s.audit} /><AuditTable limit={200} /></Card>
    </div>
  );
}
