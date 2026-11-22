"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { edge } from "@/lib/rpc";

export interface SecretStatus { integration_id: string; name: string; last4: string; updated_at: string }

/** Write-only secret input: the value goes to the admin-integrations Edge Function and is never read back. */
export function SecretField({ integration, name, label, status }: { integration: string; name: "api_key" | "callback_secret"; label: string; status?: SecretStatus }) {
  const { t } = useI18n();
  const it = t.super.integrations;
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const save = useAction((v: string) => edge("admin-integrations", { action: "set_secret", integration, name, value: v }), {
    success: it.keySaved, onSuccess: () => { setValue(""); qc.invalidateQueries({ queryKey: ["secret-status"] }); qc.invalidateQueries({ queryKey: ["integrations"] }); },
  });
  return (
    <div>
      <Label>{label}</Label>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <KeyRound className="size-3.5" /> {status ? `${it.configuredLast4} ••••${status.last4}` : it.notSet}
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) save.run(value.trim()); }}>
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="••••••••" />
        <Button type="submit" size="sm" className="h-10" loading={save.pending} disabled={!value.trim()}>{it.saveKey}</Button>
        {status && <Button type="button" size="sm" variant="ghost" className="h-10" onClick={() => save.run("")}>{it.removeKey}</Button>}
      </form>
    </div>
  );
}
