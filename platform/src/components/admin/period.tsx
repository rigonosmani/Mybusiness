"use client";
import { useI18n } from "@/lib/i18n";

export function PeriodSelect({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const { t } = useI18n();
  return (
    <select value={days} onChange={(e) => onChange(Number(e.target.value))} aria-label={t.common.period}
      className="h-9 rounded-md border border-input bg-panel-2 px-3 text-sm">
      <option value={7}>{t.common.last7}</option>
      <option value={30}>{t.common.last30}</option>
      <option value={90}>{t.common.last90}</option>
    </select>
  );
}

export function periodArgs(days: number) {
  return { p_from: new Date(Date.now() - days * 86_400_000).toISOString(), p_to: new Date().toISOString() };
}
