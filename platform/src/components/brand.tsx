import { cn } from "@/lib/utils";

/** Original Kometa mark: a comet with a three-stroke tail. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="km-tail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(186 90% 52%)" stopOpacity="0" />
          <stop offset="1" stopColor="hsl(186 90% 52%)" />
        </linearGradient>
        <radialGradient id="km-core" cx="0.4" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="hsl(38 96% 62%)" />
          <stop offset="1" stopColor="hsl(20 90% 50%)" />
        </radialGradient>
      </defs>
      <path d="M4 30 L24 14" stroke="url(#km-tail)" strokeWidth="4" strokeLinecap="round" />
      <path d="M7 36 L25 19" stroke="url(#km-tail)" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <path d="M2 22 L21 11" stroke="url(#km-tail)" strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <circle cx="28" cy="12" r="8" fill="url(#km-core)" />
      <circle cx="25.5" cy="9.5" r="2" fill="#fff" opacity=".8" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-lg font-extrabold tracking-tight">KOMETA</span>
    </span>
  );
}
