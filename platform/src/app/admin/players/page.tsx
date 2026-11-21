"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Eye, KeyRound, MoreHorizontal, Pencil, Search, ShieldOff, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AmountDialog, CreateAccountDialog, EditNameDialog, PasswordDialog } from "@/components/admin/dialogs";
import { useProfile } from "@/components/providers";
import { useAction } from "@/hooks/use-action";
import { useBalance } from "@/hooks/use-balance";
import { useI18n } from "@/lib/i18n";
import { errorMessage } from "@/lib/errors";
import { formatCredits, toBigInt } from "@/lib/money";
import { edge, rpc } from "@/lib/rpc";
import { formatDateTime, newKey } from "@/lib/utils";

interface PlayerRow { id: string; username: string; display_name: string; status: string; balance: number; created_at: string; last_login_at: string | null; open_bets: number; self_excluded_until: string | null }
type Dlg = { kind: "create" } | { kind: "edit" | "password" | "transfer" | "reclaim"; player: PlayerRow } | null;

function PlayersContent() {
  const { t, locale } = useI18n();
  const me = useProfile();
  const qc = useQueryClient();
  const params = useSearchParams();
  const balance = useBalance(me.id);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["my-players"], queryFn: () => rpc<PlayerRow[]>("list_my_players") });
  useEffect(() => { if (params.get("create")) setDlg({ kind: "create" }); }, [params]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["my-players"] }); qc.invalidateQueries({ queryKey: ["admin-overview"] }); };
  const close = () => setDlg(null);

  const create = useAction((v: { username: string; display_name: string; password: string }) => edge("admin-users", { action: "create_player", ...v }),
    { success: t.admin.playerCreated, onSuccess: () => { close(); refresh(); } });
  const edit = useAction((id: string, name: string) => rpc("update_account", { p_user_id: id, p_display_name: name }), { success: t.profile.saved, onSuccess: () => { close(); refresh(); } });
  const resetPw = useAction((id: string, pw: string) => edge("admin-users", { action: "reset_password", user_id: id, password: pw }), { success: t.admin.passwordReset, onSuccess: close });
  const setStatus = useAction((id: string, status: string) => edge("admin-users", { action: "set_status", user_id: id, status }), { success: t.admin.statusChanged, onSuccess: refresh });
  const transfer = useAction((id: string, units: bigint, note: string) =>
    rpc("transfer_to_player", { p_player_id: id, p_amount: units.toString(), p_note: note || null, p_idempotency_key: newKey() }),
    { success: t.admin.transferDone, onSuccess: () => { close(); refresh(); } });
  const reclaim = useAction((id: string, units: bigint, note: string) =>
    rpc("reclaim_from_player", { p_player_id: id, p_amount: units.toString(), p_note: note || null, p_idempotency_key: newKey() }),
    { success: t.admin.reclaimDone, onSuccess: () => { close(); refresh(); } });

  const rows = (q.data ?? []).filter((p) => !filter || p.username.includes(filter.toLowerCase()) || p.display_name.toLowerCase().includes(filter.toLowerCase()));
  const myBalance = balance.data ? toBigInt(balance.data) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t.nav.players} description={t.admin.permissionsNote} actions={<Button onClick={() => setDlg({ kind: "create" })}><UserPlus /> {t.admin.createPlayer}</Button>} />
      <Card>
        <div className="relative mb-4 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t.common.search} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {q.isLoading ? <SkeletonRows /> : q.error ? <ErrorState message={errorMessage(q.error, t)} /> : rows.length === 0 ? <EmptyState title={t.common.empty} icon={<Users />} /> : (
          <Table>
            <THead><tr><TH>{t.common.username}</TH><TH>{t.common.status}</TH><TH className="text-right">{t.common.balance}</TH><TH className="text-right">{t.admin.openBets}</TH><TH>{t.common.created}</TH><TH>{t.common.lastLogin}</TH><TH className="text-right">{t.common.actions}</TH></tr></THead>
            <TBody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD><Link href={`/admin/players/${p.id}`} className="font-medium hover:text-primary">{p.display_name}</Link><p className="text-xs text-muted-foreground">@{p.username}</p></TD>
                  <TD><StatusBadge status={p.status} labels={{ active: t.common.active, suspended: t.common.suspended, deactivated: t.common.deactivated }} /></TD>
                  <TD className="text-right font-semibold tabular-nums">{formatCredits(p.balance)}</TD>
                  <TD className="text-right">{p.open_bets}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(p.created_at, locale)}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{p.last_login_at ? formatDateTime(p.last_login_at, locale) : t.common.never}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "transfer", player: p })} disabled={p.status !== "active"}><ArrowUpRight /> <span className="hidden xl:inline">{t.admin.transfer}</span></Button>
                      <Dropdown trigger={<Button size="icon" variant="ghost" aria-label={t.common.actions}><MoreHorizontal /></Button>}>
                        <DropdownItem onSelect={() => setDlg({ kind: "reclaim", player: p })}><ArrowDownLeft /> {t.admin.reclaim}</DropdownItem>
                        <DropdownItem onSelect={() => setDlg({ kind: "edit", player: p })}><Pencil /> {t.admin.editPlayer}</DropdownItem>
                        <DropdownItem onSelect={() => setDlg({ kind: "password", player: p })}><KeyRound /> {t.admin.resetPassword}</DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem onSelect={() => location.assign(`/admin/players/${p.id}`)}><Eye /> {t.common.view}</DropdownItem>
                        {p.status === "active"
                          ? <DropdownItem danger onSelect={() => setStatus.run(p.id, "suspended")}><ShieldOff /> {t.admin.suspend}</DropdownItem>
                          : <DropdownItem onSelect={() => setStatus.run(p.id, "active")}><ShieldCheck /> {t.admin.activate}</DropdownItem>}
                      </Dropdown>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <CreateAccountDialog open={dlg?.kind === "create"} onOpenChange={(o) => !o && close()} title={t.admin.createPlayer} pending={create.pending} onSubmit={(v) => create.run(v)} />
      {dlg && dlg.kind !== "create" && (<>
        <EditNameDialog open={dlg.kind === "edit"} onOpenChange={(o) => !o && close()} title={t.admin.editPlayer} initial={dlg.player.display_name} pending={edit.pending} onSubmit={(n) => edit.run(dlg.player.id, n)} />
        <PasswordDialog open={dlg.kind === "password"} onOpenChange={(o) => !o && close()} title={`${t.admin.resetPassword} · @${dlg.player.username}`} pending={resetPw.pending} onSubmit={(pw) => resetPw.run(dlg.player.id, pw)} />
        <AmountDialog open={dlg.kind === "transfer"} onOpenChange={(o) => !o && close()} title={`${t.admin.transfer} → @${dlg.player.username}`} max={myBalance}
          confirmLabel={t.admin.transfer} pending={transfer.pending} onSubmit={(u, n) => transfer.run(dlg.player.id, u, n)} />
        <AmountDialog open={dlg.kind === "reclaim"} onOpenChange={(o) => !o && close()} title={`${t.admin.reclaim} ← @${dlg.player.username}`} max={toBigInt(dlg.player.balance)}
          confirmLabel={t.admin.reclaim} pending={reclaim.pending} onSubmit={(u, n) => reclaim.run(dlg.player.id, u, n)} />
      </>)}
    </div>
  );
}

export default function PlayersPage() {
  return <Suspense><PlayersContent /></Suspense>;
}
