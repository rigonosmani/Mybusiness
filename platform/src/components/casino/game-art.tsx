import {
  Bomb, Coins, Orbit, Crown, Dice5, Gem, Grid3x3, Rocket, Spade, Sparkles, Target, TrendingUp, Triangle, CircleDot, Club, Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Original procedurally drawn cover art (no third-party assets). */
const ART: Record<string, { icon: LucideIcon; from: string; to: string; motif: "rings" | "grid" | "rays" | "dots" }> = {
  dice: { icon: Dice5, from: "#1fd2ee", to: "#3b49df", motif: "dots" },
  crash: { icon: Rocket, from: "#f97316", to: "#be123c", motif: "rays" },
  mines: { icon: Bomb, from: "#22c55e", to: "#0f766e", motif: "grid" },
  plinko: { icon: Triangle, from: "#e879f9", to: "#7c3aed", motif: "dots" },
  limbo: { icon: TrendingUp, from: "#facc15", to: "#ea580c", motif: "rays" },
  roulette: { icon: CircleDot, from: "#ef4444", to: "#14532d", motif: "rings" },
  blackjack: { icon: Spade, from: "#334155", to: "#0f172a", motif: "grid" },
  coinflip: { icon: Coins, from: "#fbbf24", to: "#a16207", motif: "rings" },
  hilo: { icon: Layers, from: "#38bdf8", to: "#1e3a8a", motif: "grid" },
  keno: { icon: Grid3x3, from: "#a3e635", to: "#15803d", motif: "dots" },
  baccarat: { icon: Crown, from: "#c084fc", to: "#581c87", motif: "rings" },
  videopoker: { icon: Club, from: "#2dd4bf", to: "#134e4a", motif: "grid" },
  slot_neon_orchard: { icon: Sparkles, from: "#f472b6", to: "#7e22ce", motif: "rays" },
  slot_astro_gems: { icon: Gem, from: "#60a5fa", to: "#312e81", motif: "dots" },
  slot_cosmic_cascade: { icon: Orbit, from: "#a855f7", to: "#0e7490", motif: "rings" },
};

/** Cover built from the game's own artwork. */
function CascadeCover({ name, className }: { name: string; className?: string }) {
  const img = (f: string, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/games/cosmic-cascade/${f}.webp`} alt="" className={cn("absolute object-contain", cls)} draggable={false} />
  );
  return (
    <div className={cn("relative aspect-[4/5] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_50%_30%,#7c3aed,#1e1b4b_60%,#020617)]", className)}>
      {img("blackhole", "left-1/2 top-[6%] w-[80%] -translate-x-1/2 opacity-80 animate-[spin_14s_linear_infinite]")}
      {img("nova", "left-1/2 top-[18%] w-[46%] -translate-x-1/2 drop-shadow-[0_0_18px_rgba(250,204,21,.6)]")}
      {img("gem_violet", "left-[4%] top-[52%] w-[34%] -rotate-12")}
      {img("gem_green", "right-[4%] top-[54%] w-[32%] rotate-12")}
      {img("comet", "right-[-6%] top-[2%] w-[40%]")}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
        <p className="text-sm font-extrabold uppercase tracking-wide text-white">{name}</p>
      </div>
    </div>
  );
}

export function GameArt({ id, name, className, thumbnail }: { id: string; name: string; className?: string; thumbnail?: string | null }) {
  if (id === "slot_cosmic_cascade") return <CascadeCover name={name} className={className} />;
  if (thumbnail) {
    return (
      <div className={cn("relative aspect-[4/5] overflow-hidden rounded-lg bg-panel-3", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnail} alt={name} loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8"><p className="text-sm font-extrabold uppercase tracking-wide text-white">{name}</p></div>
      </div>
    );
  }
  const a = ART[id] ?? { icon: Target, from: "#64748b", to: "#1e293b", motif: "dots" as const };
  const Icon = a.icon;
  return (
    <div className={cn("relative aspect-[4/5] overflow-hidden rounded-lg", className)} style={{ background: `linear-gradient(150deg, ${a.from}, ${a.to})` }}>
      <svg className="absolute inset-0 h-full w-full opacity-25" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden>
        {a.motif === "rings" && [20, 35, 50, 65].map((r) => <circle key={r} cx="80" cy="20" r={r} fill="none" stroke="#fff" strokeWidth="1" />)}
        {a.motif === "grid" && Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${i * 14} 0V125M0 ${i * 17}H100`} stroke="#fff" strokeWidth=".6" />)}
        {a.motif === "rays" && Array.from({ length: 9 }, (_, i) => <path key={i} d={`M0 125L${i * 14} 0`} stroke="#fff" strokeWidth=".8" />)}
        {a.motif === "dots" && Array.from({ length: 30 }, (_, i) => <circle key={i} cx={(i * 37) % 100} cy={(i * 53) % 125} r="1.6" fill="#fff" />)}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <Icon className="size-1/3 text-white drop-shadow-[0_6px_20px_rgba(0,0,0,.35)]" strokeWidth={1.6} />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
        <p className="text-sm font-extrabold uppercase tracking-wide text-white">{name}</p>
      </div>
    </div>
  );
}
