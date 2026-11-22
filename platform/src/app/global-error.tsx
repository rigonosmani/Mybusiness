"use client";

/**
 * Last-resort error screen (errors in the root layout). Inline styles on purpose:
 * it must stay readable even if the stylesheet or providers failed to load.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="sq">
      <body style={{ background: "#0b1020", color: "#e8ecf6", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Diçka shkoi keq · Something went wrong</p>
          <p style={{ fontSize: 13, color: "#9aa3b8", maxWidth: 480, wordBreak: "break-word" }}>
            {error.message || "Unknown error"}{error.digest ? ` (ref ${error.digest})` : ""}
          </p>
          <button onClick={reset} style={{ background: "#1fd2ee", color: "#0b1020", border: 0, borderRadius: 8, padding: "10px 18px", fontWeight: 600 }}>
            Provo përsëri · Retry
          </button>
          <a href="/login" style={{ color: "#1fd2ee", fontSize: 13 }}>/login</a>
        </main>
      </body>
    </html>
  );
}
