"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { newKey } from "@/lib/utils";
import { ConfirmDialog } from "./dialogs";

/** Compensating reversal of a transfer (the original stays in the ledger). */
export function ReverseButton({ txId, types, txType, reversed }: { txId: string; types: string[]; txType: string; reversed?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const act = useAction((reason: string) => rpc("reverse_transaction", { p_tx_id: txId, p_reason: reason, p_idempotency_key: newKey() }), {
    success: t.admin.reversed, onSuccess: () => { setOpen(false); qc.invalidateQueries(); },
  });
  if (!types.includes(txType) || reversed) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Undo2 /> {t.admin.reverse}</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t.admin.reverse} confirmLabel={t.admin.reverse} withReason danger pending={act.pending} onConfirm={(r) => act.run(r)} />
    </>
  );
}
