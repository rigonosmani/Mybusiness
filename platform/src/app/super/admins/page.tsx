"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, KeyRound, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, UserCog, UserPlus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { EmptyState, ErrorState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AmountDialog, CreateAccountDialog, EditNameDialog, PasswordDialog, ConfirmDialog } from "@/components/admin/dialogs";
import { useProfile } from "@/components/providers";
import { useAction } from "@/hooks/use-action";
import { useBalance } from "@/hooks/use-balance";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits, toBigInt } from "@/lib/money";
import { edge, rpc } from "@/lib/rpc";
import { formatDateTime, newKey } from "@/lib/utils";

interface AdminRow { id: string; username: string; display_name: string; status: string; tenant_id: string; balance: number; created_at: string; last_login_at: string | null; player_count: number; permissions: Record<string, boolean> }
type Dlg = { kind: "create" } | { kind: "edit" | "password" | "allocate" | "reclaim" | "deactivate"; admin: AdminRow } | null;

export default function AdminsPage() {
  const { t, locale } = useI18n();
  const me = useProfile();
  const qc = useQueryClient();
  const balance = useBalance(me.id);
  const [dlg, setDlg] = useState<Dlg>(null);
  const q = useQuery({ queryKey: ["admins"], queryFn: () => rpc<AdminRow[]>("list_admins") });
  const close = () => setDlg(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admins"] }); qc.invalidateQueries({ queryKey: ["super-overview"] }); qc.invalidateQueries({ queryKey: ["balance"] }); qc.invalidateQueries({ queryKey: ["ledger"] }); };

  const create = useAction((v: { username: string; display_name: string; password: string }) => edge("admin-users", { action: "create_admin", ...v }),
    { success: t.profile.saved, onSuccess: () => { close(); refresh(); } });
  const edit = useAction((id: string, name: string) => rpc("update_account", { p_user_id: id, p_display_name: name }), { success: t.profile.saved, onSuccess: () => { close(); refresh(); } });
  const resetPw = useAction((id: string, pw: string) => edge("admin-users", { action: "reset_password", user_id: id, password: pw }), { success: t.admin.passwordReset, onSuccess: close });
  const setStatus = useAction((id: string, status: string) => edge("admin-users", { action: "set_status", user_id: id, status }), { success: t.admin.statusChanged, onSuccess: () => { close(); refresh(); } });
  const allocate = useAction((id: string, u: bigint, note: string) => rpc("allocate_credits", { p_admin_id: id, p_amount: u.toString(), p_note: note || null, p_idempotency_key: newKey() }),
    { success: t.admin.transferDone, onSuccess: () => { close(); refresh(); } });
  const reclaim = useAction((id: string, u: bigint, note: string) => rpc("reclaim_credits", { p_admin_id: id, p_amount: u.toString(), p_note: note || null, p_idempotency_key: newKey() }),
    { success: t.admin.reclaimDone, onSuccess: () => { close(); refresh(); } });

  return (
    <div className="space-y-6">
      <PageHeader title={t.super.admins} actions={<Button onClick={() => setDlg({ kind: "create" })}><UserPlus /> {t.super.createAdmin}</Button>} />
      <Notice>{t.super.noPlayerAccess}</Notice>
      <Card>
        {q.isLoading ? <SkeletonRows /> : q.error ? <ErrorState message={errorMessage(q.error, t)} /> : !q.data?.length ? <EmptyState title={t.common.empty} icon={<UserCog />} /> : (
          <Table>
            <THead><tr><TH>{t.common.displayName}</TH><TH>{t.common.username}</TH><TH>{t.common.status}</TH><TH className="text-right">{t.common.balance}</TH><TH className="text-right">{t.super.playersCount}</TH><TH>{t.common.created}</TH><TH>{t.common.lastLogin}</TH><TH className="text-right">{t.common.actions}</TH></tr></THead>
            <TBody>
              {q.data.map((a) => (
                <TR key={a.id}>
                  <TD><Link href={`/super/admins/${a.id}`} className="font-medium hover:text-primary">{a.display_name}</Link></TD>
                  <TD className="text-muted-foreground">@{a.username}</TD>
                  <TD><StatusBadge status={a.status} labels={{ active: t.common.active, suspended: t.common.suspended, deactivated: t.common.deactivated }} /></TD>
                  <TD className="text-right font-semibold tabular-nums">{formatCredits(a.balance)}</TD>
                  <TD className="text-right">{a.player_count}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at, locale)}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{a.last_login_at ? formatDateTime(a.last_login_at, locale) : t.common.never}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "allocate", admin: a })} disabled={a.status !== "active"}><ArrowUpRight /> <span className="hidden xl:inline">{t.super.allocate}</span></Button>
                      <Dropdown trigger={<Button size="icon" variant="ghost" aria-label={t.common.actions}><MoreHorizontal /></Button>}>
                        <DropdownItem onSelect={() => setDlg({ kind: "reclaim", admin: a })}><ArrowDownLeft /> {t.super.reclaim}</DropdownItem>
                        <DropdownItem onSelect={() => setDlg({ kind: "edit", admin: a })}><Pencil /> {t.super.editAdmin}</DropdownItem>
                        <DropdownItem onSelect={() => setDlg({ kind: "password", admin: a })}><KeyRound /> {t.super.resetPassword}</DropdownItem>
                        <DropdownItem onSelect={() => location.assign(`/super/admins/${a.id}`)}><BookOpen /> {t.super.viewLedger}</DropdownItem>
                        <DropdownSeparator />
                        {a.status === "active"
                          ? <DropdownItem danger onSelect={() => setStatus.run(a.id, "suspended")}><ShieldOff /> {t.admin.suspend}</DropdownItem>
                          : <DropdownItem onSelect={() => setStatus.run(a.id, "active")}><ShieldCheck /> {t.admin.activate}</DropdownItem>}
                        {a.status !== "deactivated" && <DropdownItem danger onSelect={() => setDlg({ kind: "deactivate", admin: a })}><UserX /> {t.common.deactivated}</DropdownItem>}
                      </Dropdown>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateAccountDialog open={dlg?.kind === "create"} onOpenChange={(o) => !o && close()} title={t.super.createAdmin} pending={create.pending} onSubmit={(v) => create.run(v)} />
      {dlg && dlg.kind !== "create" && (<>
        <EditNameDialog open={dlg.kind === "edit"} onOpenChange={(o) => !o && close()} title={t.super.editAdmin} initial={dlg.admin.display_name} pending={edit.pending} onSubmit={(n) => edit.run(dlg.admin.id, n)} />
        <PasswordDialog open={dlg.kind === "password"} onOpenChange={(o) => !o && close()} title={`${t.super.resetPassword} · @${dlg.admin.username}`} pending={resetPw.pending} onSubmit={(pw) => resetPw.run(dlg.admin.id, pw)} />
        <AmountDialog open={dlg.kind === "allocate"} onOpenChange={(o) => !o && close()} title={`${t.super.allocate} → @${dlg.admin.username}`}
          max={balance.data ? toBigInt(balance.data) : null} confirmLabel={t.super.allocate} pending={allocate.pending} onSubmit={(u, n) => allocate.run(dlg.admin.id, u, n)} />
        <AmountDialog open={dlg.kind === "reclaim"} onOpenChange={(o) => !o && close()} title={`${t.super.reclaim} ← @${dlg.admin.username}`}
          max={toBigInt(dlg.admin.balance)} confirmLabel={t.super.reclaim} pending={reclaim.pending} onSubmit={(u, n) => reclaim.run(dlg.admin.id, u, n)} />
        <ConfirmDialog open={dlg.kind === "deactivate"} onOpenChange={(o) => !o && close()} title={`${t.common.deactivated}: @${dlg.admin.username}`} danger
          confirmLabel={t.common.confirm} pending={setStatus.pending} onConfirm={() => setStatus.run(dlg.admin.id, "deactivated")} />
      </>)}
    </div>
  );
}
