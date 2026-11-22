"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LogIn } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") === "suspended" ? t.auth.suspended : null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const sb = supabaseBrowser();
    // Usernames map to <username>@AUTH_EMAIL_DOMAIN; a full e-mail address is used as typed.
    const id = username.trim().toLowerCase();
    const email = id.includes("@") ? id : `${id}@${process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN}`;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setPending(false);
      setError(error?.message?.toLowerCase().includes("banned") ? t.auth.suspended : t.auth.invalid);
      return;
    }
    const { data: profile } = await sb.from("profiles").select("role, status").eq("id", data.user.id).single();
    if (!profile || profile.status !== "active") {
      await sb.auth.signOut();
      setPending(false);
      setError(t.auth.suspended);
      return;
    }
    const next = params.get("next");
    const home = profile.role === "super_admin" ? "/super" : profile.role === "admin" ? "/admin" : "/";
    router.replace(next && next.startsWith(home === "/" ? "/" : home) && !next.startsWith("//") ? next : home);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LocaleSwitch />
      </div>
      <h1 className="text-xl font-bold">{t.auth.title}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t.auth.subtitle}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t.auth.loginId} htmlFor="u">
          <Input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label={t.common.password} htmlFor="p">
          <Input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={pending}><LogIn /> {t.auth.submit}</Button>
      </form>
      <div className="mt-6"><Notice>{t.demo.banner}</Notice></div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense><LoginForm /></Suspense>
    </main>
  );
}
