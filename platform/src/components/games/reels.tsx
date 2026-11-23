"use client";
/**
 * Real slot reels: each column is a strip of symbols that rolls downward, then
 * decelerates onto the server's result with a small overshoot. Columns stop one
 * after another. Pure presentation — outcomes always come from the server.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const LOOP = 10;   // symbols in the looping strip (rendered twice)
const RUN_IN = 14; // random symbols scrolled past while stopping

const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

export interface ReelsProps {
  cols: number;
  rows: number;
  /** Column-major grid shown when idle (index = col * rows + row). */
  grid: string[];
  /** Increments on every spin. */
  spinId: number;
  /** Final grid for the current spin; null while waiting for the server. */
  target: string[] | null;
  pool: string[];
  render: (id: string) => ReactNode;
  /** Highlighted cells (indexes) after the reels stopped. */
  winning?: Set<number>;
  onAllStopped?: () => void;
  cellClassName?: string;
  colClassName?: string;
  /** Time between column stops (ms). */
  stagger?: number;
}

export function Reels(p: ReelsProps) {
  const [stopped, setStopped] = useState(0);
  const done = useRef(0);
  useEffect(() => { done.current = 0; setStopped(0); }, [p.spinId]);
  const onStop = () => {
    done.current += 1;
    setStopped(done.current);
    if (done.current === p.cols) p.onAllStopped?.();
  };
  const settled = p.spinId === 0 || stopped >= p.cols;
  return (
    <>
      {Array.from({ length: p.cols }, (_, c) => (
        <Reel key={c} col={c} rows={p.rows} spinId={p.spinId}
          idle={p.grid.slice(c * p.rows, c * p.rows + p.rows)}
          target={p.target ? p.target.slice(c * p.rows, c * p.rows + p.rows) : null}
          pool={p.pool} render={p.render} onStop={onStop} stagger={p.stagger ?? 190}
          winning={settled ? p.winning : undefined} cellClassName={p.cellClassName} className={p.colClassName} />
      ))}
    </>
  );
}

type Mode = "idle" | "loop" | "stop";

function Reel({ col, rows, spinId, idle, target, pool, render, onStop, stagger, winning, cellClassName, className }: {
  col: number; rows: number; spinId: number; idle: string[]; target: string[] | null; pool: string[]; render: (id: string) => ReactNode;
  onStop: () => void; stagger: number; winning?: Set<number>; cellClassName?: string; className?: string;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [shown, setShown] = useState<string[]>(idle);
  const [loopStrip, setLoopStrip] = useState<string[]>([]);
  const [stopStrip, setStopStrip] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [landed, setLanded] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const started = useRef(0);

  // Keep the idle view in sync when the parent changes the grid outside of a spin.
  useEffect(() => { if (mode === "idle") setShown(idle); }, [idle.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // New spin → start rolling.
  useEffect(() => {
    if (spinId === 0) return;
    const strip = Array.from({ length: LOOP }, () => pick(pool));
    setLoopStrip([...strip, ...strip]);
    setMode("loop");
    started.current = performance.now();
  }, [spinId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Result arrived → stop this column after its turn (min. spin time + stagger).
  useEffect(() => {
    if (!target || mode !== "loop") return;
    const wait = Math.max(0, 380 - (performance.now() - started.current)) + col * stagger;
    const id = setTimeout(() => {
      setStopStrip([...target, ...Array.from({ length: RUN_IN }, () => pick(pool)), ...shown]);
      setArmed(false);
      setMode("stop");
    }, wait);
    return () => clearTimeout(id);
  }, [target?.join(), mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two-frame start so the transition runs from the top of the strip.
  useLayoutEffect(() => {
    if (mode !== "stop") return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    const fallback = setTimeout(() => finishRef.current(), 1200); // background tabs may skip transitionend
    return () => { cancelAnimationFrame(r); clearTimeout(fallback); };
  }, [mode, stopStrip]);

  const finish = () => {
    if (mode !== "stop" || !target) return;
    setShown(target);
    setMode("idle");
    setLanded((n) => n + 1);
    onStop();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const cell = (id: string, i: number, key: string, win = false) => (
    <div key={key} className={cn("aspect-square w-full shrink-0 p-[6%]", cellClassName)}>
      <div className={cn("size-full", win && "animate-[reel-win_0.9s_ease-in-out_infinite]")}>{render(id)}</div>
    </div>
  );

  const total = stopStrip.length;
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ aspectRatio: `1 / ${rows}` }}>
      {mode === "idle" && (
        <div key={landed} className={cn("flex flex-col", landed > 0 && "animate-[reel-land_.28s_ease-out]")}>
          {shown.map((id, r) => cell(id, r, `i${r}`, winning?.has(col * rows + r)))}
          {winning && winning.size > 0 && <DimOverlay rows={rows} col={col} winning={winning} />}
        </div>
      )}
      {mode === "loop" && (
        <div className="flex flex-col blur-[1.5px] [animation:reel-loop_.32s_linear_infinite]">
          {loopStrip.map((id, i) => cell(id, i, `l${i}`))}
        </div>
      )}
      {mode === "stop" && (
        <div ref={stripRef} onTransitionEnd={finish} className="flex flex-col"
          style={{
            transform: armed ? "translateY(0)" : `translateY(-${((total - rows) / total) * 100}%)`,
            transition: armed ? "transform 640ms cubic-bezier(.12,.72,.22,1)" : "none",
            filter: armed ? undefined : "blur(1.5px)",
          }}>
          {stopStrip.map((id, i) => cell(id, i, `s${i}`))}
        </div>
      )}
      {/* glass + depth shading */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.55),transparent_18%,transparent_82%,rgba(0,0,0,.55))]" />
    </div>
  );
}

function DimOverlay({ rows, col, winning }: { rows: number; col: number; winning: Set<number> }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={cn("flex-1 transition-colors duration-300", !winning.has(col * rows + r) && "bg-black/45")} />
      ))}
    </div>
  );
}

/** Counts up to a value (for win amounts). */
export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target <= 0) { setV(0); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Coins bursting out of the centre for big wins. */
export function CoinBurst({ count = 26 }: { count?: number }) {
  const coins = useRef(Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 60, rot: (Math.random() - 0.5) * 720, delay: Math.random() * 250, size: 14 + Math.random() * 14 };
  })).current;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
      {coins.map((c, i) => (
        <span key={i} className="absolute rounded-full border-2 border-amber-600 bg-[radial-gradient(circle_at_35%_30%,#fff6b0,#ffc400_45%,#b37400)] shadow"
          style={{ width: c.size, height: c.size, animation: `coin-fly 1.2s ${c.delay}ms cubic-bezier(.2,.7,.4,1) forwards`,
            ["--dx" as string]: `${c.dx}px`, ["--dy" as string]: `${c.dy}px`, ["--rot" as string]: `${c.rot}deg` }} />
      ))}
    </div>
  );
}
