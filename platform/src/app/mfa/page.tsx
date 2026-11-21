"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function MfaPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      // Remove abandoned unverified factors, then enroll a fresh one.
      for (const f of data?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `kometa-${Date.now()}` });
      if (error || !enrolled) return setError(error?.message ?? "MFA");
      setFactorId(enrolled.id);
      setQr(enrolled.totp.qr_code);
      setSecret(enrolled.totp.secret);
    })();
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setPending(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setPending(false);
    if (error) return setError(t.auth.mfaInvalid);
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <Logo className="mb-6" />
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="size-5 text-primary" /> {t.auth.mfaTitle}</h1>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{qr ? t.auth.mfaEnrollHint : t.auth.mfaRequired}</p>
        {qr && (
          <div className="mb-4 space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="TOTP QR" className="mx-auto size-44 rounded-md bg-white p-2" />
            <p className="break-all text-center font-mono text-xs text-muted-foreground">{secret}</p>
          </div>
        )}
        <form onSubmit={verify} className="space-y-4">
          <Field label={t.auth.mfaCode} htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={pending} disabled={!factorId}>{t.auth.mfaVerify}</Button>
        </form>
      </Card>
    </main>
  );
}
