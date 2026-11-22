/**
 * Original vector artwork for Cosmic Cascade (no third-party assets).
 * Each symbol is a self-contained SVG with its own gradients (ids are
 * namespaced with useId so many copies can live on one page).
 */
import { useId } from "react";

function Gem({ c1, c2, c3 }: { c1: string; c2: string; c3: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.45)]">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c3} /></linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M50 8 L86 34 L72 88 L28 88 L14 34 Z" fill={`url(#${id}a)`} stroke={c3} strokeWidth="2" />
      <path d="M50 8 L64 34 L50 88 L36 34 Z" fill={c2} opacity=".55" />
      <path d="M14 34 L86 34" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" />
      <path d="M50 8 L86 34 L50 34 L14 34 Z" fill={`url(#${id}b)`} opacity=".7" />
      <circle cx="38" cy="24" r="4" fill="#fff" opacity=".9" />
    </svg>
  );
}

function Planet({ ringed }: { ringed?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.45)]">
      <defs>
        <radialGradient id={`${id}p`} cx=".35" cy=".3" r=".75">
          <stop offset="0" stopColor={ringed ? "#ffe7a3" : "#a7f3d0"} />
          <stop offset=".55" stopColor={ringed ? "#f59e0b" : "#10b981"} />
          <stop offset="1" stopColor={ringed ? "#7c2d12" : "#064e3b"} />
        </radialGradient>
      </defs>
      {ringed && <ellipse cx="50" cy="54" rx="46" ry="14" fill="none" stroke="#fde68a" strokeWidth="5" opacity=".9" transform="rotate(-18 50 54)" />}
      <circle cx="50" cy="50" r="30" fill={`url(#${id}p)`} />
      {!ringed && <path d="M24 44 Q50 36 76 46 M22 56 Q50 50 78 60" stroke="#065f46" strokeWidth="4" fill="none" opacity=".5" />}
      {ringed && <path d="M6 62 Q50 82 94 46" fill="none" stroke="#fde68a" strokeWidth="5" opacity=".95" transform="rotate(-6 50 54)" />}
      <circle cx="40" cy="38" r="6" fill="#fff" opacity=".55" />
    </svg>
  );
}

function Rocket() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.45)]">
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1"><stop offset="0" stopColor="#e2e8f0" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#94a3b8" /></linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fde047" /><stop offset="1" stopColor="#ef4444" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M50 92 L42 72 L58 72 Z" fill={`url(#${id}f)`} />
      <path d="M50 8 C66 22 66 52 60 72 L40 72 C34 52 34 22 50 8 Z" fill={`url(#${id}b)`} stroke="#64748b" strokeWidth="1.5" />
      <path d="M40 58 L28 74 L40 70 Z M60 58 L72 74 L60 70 Z" fill="#ef4444" />
      <circle cx="50" cy="38" r="8" fill="#38bdf8" stroke="#0c4a6e" strokeWidth="3" />
      <circle cx="47" cy="35" r="2.5" fill="#fff" />
    </svg>
  );
}

function Helmet() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.45)]">
      <defs>
        <radialGradient id={`${id}h`} cx=".4" cy=".3" r=".8"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#94a3b8" /></radialGradient>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset=".6" stopColor="#4c1d95" /><stop offset="1" stopColor="#f472b6" /></linearGradient>
      </defs>
      <circle cx="50" cy="48" r="36" fill={`url(#${id}h)`} stroke="#64748b" strokeWidth="2" />
      <rect x="24" y="30" width="52" height="34" rx="16" fill={`url(#${id}v)`} />
      <path d="M30 38 Q40 32 52 34" stroke="#fff" strokeWidth="4" fill="none" opacity=".7" strokeLinecap="round" />
      <rect x="34" y="82" width="32" height="8" rx="3" fill="#475569" />
    </svg>
  );
}

function Nova() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_0_12px_rgba(250,204,21,.6)]">
      <defs>
        <radialGradient id={`${id}n`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="#fde047" /><stop offset="1" stopColor="#ea580c" /></radialGradient>
      </defs>
      <path d="M50 4 L59 38 L94 30 L66 52 L86 84 L52 66 L22 92 L32 58 L6 40 L40 38 Z" fill={`url(#${id}n)`} stroke="#c2410c" strokeWidth="2" strokeLinejoin="round" />
      <text x="50" y="60" textAnchor="middle" fontSize="20" fontWeight="900" fill="#7c2d12">K</text>
    </svg>
  );
}

function BlackHole() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full animate-[spin_9s_linear_infinite] drop-shadow-[0_0_14px_rgba(168,85,247,.7)]">
      <defs>
        <radialGradient id={`${id}d`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" /><stop offset=".42" stopColor="#0b0217" /><stop offset=".6" stopColor="#a855f7" /><stop offset=".8" stopColor="#f472b6" stopOpacity=".7" /><stop offset="1" stopColor="#f472b6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${id}d)`} />
      <path d="M50 14 A36 36 0 0 1 86 50" stroke="#fde68a" strokeWidth="3" fill="none" opacity=".8" />
      <path d="M50 86 A36 36 0 0 1 14 50" stroke="#fde68a" strokeWidth="3" fill="none" opacity=".8" />
      <circle cx="50" cy="50" r="16" fill="#000" />
    </svg>
  );
}

function Orb({ value }: { value: number }) {
  const id = useId().replace(/:/g, "");
  const hot = value >= 25;
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_0_14px_rgba(34,211,238,.8)]">
      <defs>
        <radialGradient id={`${id}o`} cx=".38" cy=".32" r=".7">
          <stop offset="0" stopColor="#fff" /><stop offset=".45" stopColor={hot ? "#f472b6" : "#22d3ee"} /><stop offset="1" stopColor={hot ? "#7e22ce" : "#1e3a8a"} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill={`url(#${id}o)`} stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
      <text x="50" y="62" textAnchor="middle" fontSize={value >= 100 ? 26 : 32} fontWeight="900" fill="#fff" stroke="#0b1020" strokeWidth="1.5">{value}×</text>
    </svg>
  );
}

export function CascadeSymbol({ cell }: { cell: string }) {
  if (cell.startsWith("orb:")) return <Orb value={Number(cell.slice(4))} />;
  switch (cell) {
    case "nova": return <Nova />;
    case "ringed": return <Planet ringed />;
    case "rocket": return <Rocket />;
    case "helmet": return <Helmet />;
    case "gem_red": return <Gem c1="#fecaca" c2="#ef4444" c3="#7f1d1d" />;
    case "gem_violet": return <Gem c1="#ede9fe" c2="#8b5cf6" c3="#3b0764" />;
    case "gem_green": return <Gem c1="#d1fae5" c2="#10b981" c3="#064e3b" />;
    case "gem_blue": return <Gem c1="#dbeafe" c2="#3b82f6" c3="#1e3a8a" />;
    case "gem_amber": return <Gem c1="#fef3c7" c2="#f59e0b" c3="#78350f" />;
    case "blackhole": return <BlackHole />;
    default: return <Planet />;
  }
}
