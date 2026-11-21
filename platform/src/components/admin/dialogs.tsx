"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { formatCredits, parseCredits } from "@/lib/money";

/** Amount + optional note. Calls onSubmit(units, note); the caller performs the RPC. */
export function AmountDialog({ open, onOpenChange, title, description, max, confirmLabel, onSubmit, pending, showNote = true }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; max?: bigint | null;
  confirmLabel: string; onSubmit: (units: bigint, note: string) => void; pending?: boolean; showNote?: boolean;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setAmount(""); setNote(""); } }, [open]);
  const units = parseCredits(amount);
  const over = units !== null && max !== undefined && max !== null && units > max;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (units && units > 0n && !over) onSubmit(units, note); }}>
        <Field label={`${t.common.amount} (Cr)`} hint={max !== undefined && max !== null ? `${t.common.balance}: ${formatCredits(max)}` : undefined}>
          <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={units === null || over} />
        </Field>
        {over && <p className="text-sm text-danger">{t.errors.INSUFFICIENT_FUNDS}</p>}
        {showNote && <Field label={`${t.common.note} (${t.common.optional})`}><Input maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" loading={pending} disabled={!units || units <= 0n || over}>{confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, pending, danger, withReason }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; confirmLabel: string;
  onConfirm: (reason: string) => void; pending?: boolean; danger?: boolean; withReason?: boolean;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {withReason && <div className="mb-4"><Field label={t.common.reason}><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} /></Field></div>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
        <Button variant={danger ? "danger" : "default"} loading={pending} disabled={withReason && reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

export function PasswordDialog({ open, onOpenChange, title, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; onSubmit: (pw: string) => void; pending?: boolean;
}) {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  useEffect(() => { if (open) setPw(""); }, [open]);
  const generate = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    setPw(Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + (bytes[0] % 10));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}>
        <Field label={t.profile.newPassword} hint={`${t.errors.PASSWORD_LENGTH} ${t.errors.PASSWORD_COMPLEXITY}`}>
          <div className="flex gap-2"><Input value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" autoComplete="new-password" />
            <Button type="button" variant="secondary" onClick={generate}>↻</Button></div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" loading={pending} disabled={pw.length < 10}>{t.common.save}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CreateAccountDialog({ open, onOpenChange, title, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string;
  onSubmit: (v: { username: string; display_name: string; password: string }) => void; pending?: boolean;
}) {
  const { t } = useI18n();
  const [v, setV] = useState({ username: "", display_name: "", password: "" });
  useEffect(() => { if (open) setV({ username: "", display_name: "", password: "" }); }, [open]);
  const validUser = /^[a-z0-9][a-z0-9_.]{2,31}$/.test(v.username);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
        <Field label={t.common.username} hint={t.errors.INVALID_USERNAME}>
          <Input autoFocus value={v.username} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} aria-invalid={!!v.username && !validUser} autoComplete="off" />
        </Field>
        <Field label={t.common.displayName}><Input value={v.display_name} maxLength={64} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
        <Field label={t.common.password} hint={`${t.errors.PASSWORD_LENGTH} ${t.errors.PASSWORD_COMPLEXITY}`}>
          <Input type="text" className="font-mono" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" loading={pending} disabled={!validUser || v.password.length < 10}>{t.common.save}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function EditNameDialog({ open, onOpenChange, title, initial, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; initial: string; onSubmit: (name: string) => void; pending?: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  useEffect(() => { if (open) setName(initial); }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(name); }}>
        <Field label={t.common.displayName}><Input autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" loading={pending} disabled={!name.trim()}>{t.common.save}</Button>
        </div>
      </form>
    </Dialog>
  );
}
