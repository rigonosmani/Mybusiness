import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";
import type { Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { default: "Kometa — demo sportsbook & casino", template: "%s · Kometa" },
  description: "Demo-credit sportsbook and casino. Credits have no monetary value.",
  icons: { icon: "/logo.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b1020", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies();
  const locale: Locale = c.get("locale")?.value === "en" ? "en" : "sq";
  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen font-sans">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
