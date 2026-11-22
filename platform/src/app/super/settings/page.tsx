"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";

interface Setting { key: string; value: unknown; description: string | null; locked: boolean }

export default function SettingsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: async () => (await supabaseBrowser().from("platform_settings").select("*").order("key")).data as Setting[] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = useAction((key: string, value: unknown) => rpc("admin_update_setting", { p_key: key, p_value: value }), {
    success: t.profile.saved, onSuccess: () => { setDrafts({}); qc.invalidateQueries({ queryKey: ["settings"] }); },
  });
  return (
    <div className="space-y-6">
      <PageHeader title={t.super.settings.title} />
      <Card className="divide-y divide-border p-0">
        {q.isLoading && <div className="p-4"><SkeletonRows /></div>}
        {q.data?.map((s) => (
          <div key={s.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm">{s.key} {s.locked && <Badge className="ml-2"><Lock className="size-3" /> {t.super.settings.locked}</Badge>}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
            {typeof s.value === "boolean" ? (
              <Switch label={s.key} checked={s.value} disabled={s.locked || save.pending} onCheckedChange={(v) => save.run(s.key, v)} />
            ) : (
              <div className="flex gap-2 sm:w-64">
                <Input disabled={s.locked} value={drafts[s.key] ?? String(s.value)} onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))} />
                <Button size="sm" className="h-10" disabled={s.locked || drafts[s.key] === undefined} loading={save.pending}
                  onClick={() => save.run(s.key, typeof s.value === "number" ? Number(drafts[s.key]) : drafts[s.key])}>{t.common.save}</Button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
