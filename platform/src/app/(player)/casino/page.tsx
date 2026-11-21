"use client";
import { Dices } from "lucide-react";
import { PageHeader } from "@/components/ui/card";
import { Catalog } from "@/components/casino/catalog";
import { useI18n } from "@/lib/i18n";

export default function CasinoPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-2"><Dices className="text-primary" /> {t.casino.title}</span>} />
      <Catalog />
    </div>
  );
}
