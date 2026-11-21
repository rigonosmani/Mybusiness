"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { I18nProvider, type Locale } from "@/lib/i18n";
import type { SessionProfile } from "@/lib/supabase/server";

const ProfileContext = createContext<SessionProfile | null>(null);

export function useProfile(): SessionProfile {
  const p = useContext(ProfileContext);
  if (!p) throw new Error("useProfile outside an authenticated area");
  return p;
}

export function ProfileProvider({ profile, children }: { profile: SessionProfile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
  }));
  return (
    <QueryClientProvider client={qc}>
      <I18nProvider initial={locale}>
        {children}
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </I18nProvider>
    </QueryClientProvider>
  );
}
