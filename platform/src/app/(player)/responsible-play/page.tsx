"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Scale, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { formatCredits, parseCredits, unitsToInput } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

interface Overview {
  balance: number;
  today: { sports_staked: number; sports_returned: number; casino_staked: number; casino_returned: number };
  limits: { daily_wager_limit: number | null; daily_loss_limit: number | null; max_single_stake: number | null;
    pending_changes: Record<string, number | null> | null; pending_effective_at: string | null; self_excluded_until: string | null } | null;
}

export default function ResponsiblePlayPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-overview"], queryFn: () => rpc<Overview>("my_overview") });
  const [wager, setWager] = useState("");
  const [loss, setLoss] = useState("");
  const [maxStake, setMaxStake] = useState("");
  const [days, setDays] = useState("7");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const l = q.data?.limits;
    if (!l) return;
    setWager(l.daily_wager_limit ? unitsToInput(l.daily_wager_limit) : "");
    setLoss(l.daily_loss_limit ? unitsToInput(l.daily_loss_limit) : "");
    setMaxStake(l.max_single_stake ? unitsToInput(l.max_single_stake) : "");
  }, [q.data]);

  const toUnits = (s: string) => (s.trim() === "" ? null : parseCredits(s)?.toString() ?? "invalid");
  const save = useAction(async () => {
    const vals = [toUnits(wager), toUnits(loss), toUnits(maxStake)];
    if (vals.includes("invalid")) throw new Error("INVALID_AMOUNT");
    return rpc<{ pending: boolean }>("set_my_limits", { p_daily_wager_limit: vals[0], p_daily_loss_limit: vals[1], p_max_single_stake: vals[2] });
  }, { success: t.profile.saved, onSuccess: () => qc.invalidateQueries({ queryKey: ["my-overview"] }) });
  const exclude = useAction(() => rpc("request_self_exclusion", { p_days: Number(days) }), {
    onSuccess: () => { setConfirm(false); qc.invalidateQueries({ queryKey: ["my-overview"] }); },
  });

  const today = q.data?.today;
  const staked = today ? today.sports_staked + today.casino_staked : 0;
  const net = today ? today.sports_returned + today.casino_returned - staked : 0;
  const excludedUntil = q.data?.limits?.self_excluded_until;
  const excluded = excludedUntil && Date.parse(excludedUntil) > Date.now();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={<span className="flex items-center gap-2"><Scale className="text-primary" /> {t.responsible.title}</span>} description={t.responsible.intro} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={`${t.responsible.today} · ${t.responsible.wagered}`} value={formatCredits(staked)} />
        <Stat label={`${t.responsible.today} · ${t.responsible.net}`} value={formatCredits(net)} tone={net >= 0 ? "good" : "bad"} />
      </div>
      {excluded && <Notice tone="warning">{t.responsible.excludedUntil} {formatDateTime(excludedUntil, locale)}</Notice>}
      <Card>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.run(); }}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`${t.responsible.dailyWager} (Cr)`}><Input inputMode="decimal" placeholder={t.responsible.noLimit} value={wager} onChange={(e) => setWager(e.target.value)} /></Field>
            <Field label={`${t.responsible.dailyLoss} (Cr)`}><Input inputMode="decimal" placeholder={t.responsible.noLimit} value={loss} onChange={(e) => setLoss(e.target.value)} /></Field>
            <Field label={`${t.responsible.maxStake} (Cr)`}><Input inputMode="decimal" placeholder={t.responsible.noLimit} value={maxStake} onChange={(e) => setMaxStake(e.target.value)} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">{t.responsible.pending}</p>
          {q.data?.limits?.pending_effective_at && (
            <Notice>{t.responsible.pendingAt}: {formatDateTime(q.data.limits.pending_effective_at, locale)}</Notice>
          )}
          <Button type="submit" loading={save.pending}>{t.common.save}</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title={t.responsible.selfExclusion} description={t.responsible.selfExclusionText} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={days} onChange={(e) => setDays(e.target.value)} className="sm:w-48">
            {[1, 7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} {t.responsible.days}</option>)}
          </Select>
          <Button variant="danger" onClick={() => setConfirm(true)}><ShieldOff /> {t.responsible.exclude}</Button>
        </div>
      </Card>
      <Dialog open={confirm} onOpenChange={setConfirm} title={t.responsible.selfExclusion} description={t.responsible.selfExclusionText}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>{t.common.cancel}</Button>
          <Button variant="danger" loading={exclude.pending} onClick={() => exclude.run()}>{t.common.confirm} · {days} {t.responsible.days}</Button>
        </div>
      </Dialog>
    </div>
  );
}
