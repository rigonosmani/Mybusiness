import type { NextConfig } from "next";
import path from "node:path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : "";
const wsScheme = supabaseUrl.startsWith("https:") ? "wss" : "ws";

// Strict security headers. Scripts only from self; network only to our Supabase project.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // Licensed provider games open in an iframe served from the provider's own domain.
  "frame-src 'self' https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${wsScheme}://${supabaseHost}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a VPS (deploy/deploy.sh sets NEXT_OUTPUT=standalone).
  // Managed Node.js hosting (Hostinger Business/Cloud) uses the normal `next start`.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // The repo root also has a package-lock.json (older site); pin tracing to this app.
  outputFileTracingRoot: path.join(__dirname),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
