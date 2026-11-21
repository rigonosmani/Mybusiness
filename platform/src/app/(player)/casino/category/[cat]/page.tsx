"use client";
import { use } from "react";
import { PageHeader } from "@/components/ui/card";
import { Catalog } from "@/components/casino/catalog";
import { useI18n } from "@/lib/i18n";

export default function CategoryPage({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = use(params);
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t.casino.categories[cat] ?? cat} />
      <Catalog category={cat} />
    </div>
  );
}
