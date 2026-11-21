"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useProfile } from "@/components/providers";
import { useAction } from "@/hooks/use-action";
import { useI18n, type Locale } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ProfilePage() {
  const { t, locale, setLocale } = useI18n();
  const p = useProfile();
  const router = useRouter();
  const [name, setName] = useState(p.display_name);
  const [lang, setLang] = useState<Locale>(locale);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const save = useAction(() => rpc("update_my_profile", { p_display_name: name, p_locale: lang }), {
    success: t.profile.saved, onSuccess: () => { setLocale(lang); router.refresh(); },
  });
  const changePw = useAction(async () => {
    if (pw !== pw2) throw new Error("PASSWORDS_DIFFER");
    if (pw.length < 10) throw new Error("PASSWORD_LENGTH");
    if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw new Error("PASSWORD_COMPLEXITY");
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    if (error) throw error;
  }, { success: t.profile.passwordChanged, onSuccess: () => { setPw(""); setPw2(""); } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t.profile.title} description={`@${p.username}`} />
      <Card>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.run(); }}>
          <Field label={t.common.displayName}><Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t.common.language}>
            <Select value={lang} onChange={(e) => setLang(e.target.value as Locale)}><option value="sq">Shqip</option><option value="en">English</option></Select>
          </Field>
          <Button type="submit" loading={save.pending}>{t.common.save}</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title={t.profile.changePassword} />
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (pw !== pw2) { toast.error(t.profile.passwordsDiffer); return; } changePw.run(); }}>
          <Field label={t.profile.newPassword}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label={t.profile.repeatPassword}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button type="submit" loading={changePw.pending} disabled={!pw}>{t.profile.changePassword}</Button>
        </form>
      </Card>
    </div>
  );
}
