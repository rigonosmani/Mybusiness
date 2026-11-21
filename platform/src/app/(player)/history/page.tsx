"use client";
import { Card, PageHeader } from "@/components/ui/card";
import { RoundsTable } from "@/components/casino/rounds-table";
import { useProfile } from "@/components/providers";
import { useI18n } from "@/lib/i18n";

export default function HistoryPage() {
  const { t } = useI18n();
  const p = useProfile();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t.history.title} />
      <Card><RoundsTable userId={p.id} showVerify /></Card>
    </div>
  );
}
