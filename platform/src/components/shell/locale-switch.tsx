"use client";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";

export function LocaleSwitch({ persist = false }: { persist?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "sq" ? "en" : "sq";
  return (
    <button
      type="button"
      onClick={() => {
        setLocale(next);
        if (persist) rpc("update_my_profile", { p_display_name: null, p_locale: next }).catch(() => {});
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-panel-3 hover:text-foreground"
      aria-label={t.common.language}
    >
      <Languages className="size-4" /> {locale.toUpperCase()}
    </button>
  );
}
