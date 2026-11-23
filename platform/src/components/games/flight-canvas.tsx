"use client";
/**
 * Smooth 60 fps canvas for crash-style games (Kometa Jet, Crash).
 * The curve is computed analytically (m = e^(0.08·t)), so nothing is stored per
 * frame and React does not re-render while flying. The parent only updates `view`.
 */
import { useEffect, useRef } from "react";

export interface FlightView {
  phase: "idle" | "flying" | "ended";
  /** performance.now() that corresponds to t = 0 of the round. */
  origin: number;
  /** Final multiplier when ended (crash point, or the cash-out of a single-bet game). */
  endAt?: number;
  /** true = flew away / crashed (red), false = ended by cash-out only. */
  crashed?: boolean;
  /** performance.now() when the end was observed (drives the fly-away animation). */
  endedAt?: number;
  /** Multipliers where the player cashed out (green markers). */
  cashouts?: number[];
}

const GROWTH = 0.08;
const multAt = (s: number) => Math.exp(GROWTH * Math.max(0, s));
const secAt = (m: number) => Math.log(Math.max(1, m)) / GROWTH;

const JET_BODY = new Path2D("M4 18 L40 14 C50 13 58 14 62 17 C58 20 50 21 40 20 L4 19Z");
const JET_WINGS = new Path2D("M26 15 L18 2 L24 2 L36 15Z M26 19 L20 30 L26 30 L35 19Z M6 17 L2 9 L7 9 L12 16Z");
const JET_GLASS = new Path2D("M48 15 C52 15 56 16 58 17 L48 17Z");
const ROCKET_BODY = new Path2D("M6 12 L44 12 C54 12 62 14 66 16 C62 18 54 20 44 20 L6 20Z");
const ROCKET_FINS = new Path2D("M8 12 L2 2 L16 12Z M8 20 L2 30 L16 20Z");
const ROCKET_WINDOW = new Path2D("M44 16 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0");

interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number }

export function FlightCanvas({ view, sprite = "jet", labels }: {
  view: React.MutableRefObject<FlightView>;
  sprite?: "jet" | "rocket";
  labels: { flewAway: string; waiting: string; cashedOut?: string };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, s: Math.random() * 0.6 + 0.2 }));
    const particles: Particle[] = [];
    let scroll = 0;
    let last = performance.now();
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // --- sky
      const sky = ctx.createRadialGradient(w * 0.5, h * 1.1, 10, w * 0.5, h * 0.7, Math.max(w, h));
      sky.addColorStop(0, "#22336e"); sky.addColorStop(0.55, "#0b1230"); sky.addColorStop(1, "#05070f");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      const flying = v.phase === "flying";
      scroll += dt * (flying ? 0.08 : 0.01);
      for (const s of stars) {
        const x = ((s.x - scroll * s.s) % 1 + 1) % 1 * w;
        ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(now / 900 + s.x * 20));
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, s.y * h * 0.85, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- time / multiplier of the curve
      const padL = 44, padB = 30, padT = 46, padR = 18;
      const pw = w - padL - padR, ph = h - padT - padB;
      let sec: number;
      if (v.phase === "flying") sec = (now - v.origin) / 1000;
      else if (v.phase === "ended") sec = secAt(v.endAt ?? 1);
      else sec = 0;
      const m = multAt(sec);
      const maxT = Math.max(8, sec * 1.15);
      const maxM = Math.max(2, m * 1.25);
      const X = (s: number) => padL + (s / maxT) * pw;
      const Y = (mm: number) => padT + ph - ((mm - 1) / (maxM - 1)) * ph;

      // --- grid + axis labels
      ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
      ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = "11px system-ui, sans-serif";
      const mStep = niceStep((maxM - 1) / 4);
      for (let mm = 1; mm <= maxM; mm += mStep) {
        const y = Y(mm); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillText(`${mm.toFixed(mStep < 0.5 ? 2 : mStep < 1 ? 1 : 0)}×`, 6, y + 4);
      }
      const tStep = niceStep(maxT / 5);
      for (let s = 0; s <= maxT; s += tStep) {
        const x = X(s); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
        ctx.fillText(`${Math.round(s)}s`, x - 6, h - 10);
      }

      // --- curve
      const crashed = v.phase === "ended" && v.crashed;
      if (v.phase !== "idle") {
        const N = 90;
        ctx.beginPath(); ctx.moveTo(X(0), Y(1));
        for (let i = 1; i <= N; i++) { const s = (sec * i) / N; ctx.lineTo(X(s), Y(multAt(s))); }
        const tipX = X(sec), tipY = Y(m);
        ctx.save();
        const fill = ctx.createLinearGradient(0, tipY, 0, padT + ph);
        fill.addColorStop(0, crashed ? "rgba(120,120,140,.35)" : "rgba(255,40,70,.55)");
        fill.addColorStop(1, "rgba(255,40,70,0)");
        ctx.lineTo(tipX, padT + ph); ctx.lineTo(X(0), padT + ph); ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(X(0), Y(1));
        for (let i = 1; i <= N; i++) { const s = (sec * i) / N; ctx.lineTo(X(s), Y(multAt(s))); }
        ctx.strokeStyle = crashed ? "#8b8ea3" : "#ff2e4d"; ctx.lineWidth = 3.5;
        ctx.shadowColor = crashed ? "transparent" : "rgba(255,46,77,.8)"; ctx.shadowBlur = 12;
        ctx.stroke(); ctx.shadowBlur = 0;

        // cash-out markers
        for (const c of v.cashouts ?? []) {
          if (c > m + 1e-9) continue;
          const cx = X(secAt(c)), cy = Y(c);
          ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#bbf7d0"; ctx.font = "bold 12px system-ui"; ctx.fillText(`${c.toFixed(2)}×`, cx + 8, cy - 8);
        }
      }

      // --- the aircraft
      let px: number, py: number, ang: number, alpha = 1;
      if (v.phase === "idle") {
        px = X(0) + 30; py = padT + ph - 14 + Math.sin(now / 400) * 3; ang = -0.08;
      } else {
        const s0 = Math.max(0, sec - 0.25);
        px = X(sec); py = Y(m);
        ang = Math.atan2(Y(multAt(sec)) - Y(multAt(s0)), X(sec) - X(s0));
        if (v.phase === "ended" && v.crashed) {
          const k = Math.min(1, (now - (v.endedAt ?? now)) / 900);
          px += k * k * w * 0.9; py -= k * k * h * 0.9; ang = -0.75; alpha = 1 - k;
        }
      }
      if (alpha > 0.01) {
        // exhaust particles
        if (v.phase === "flying" || v.phase === "idle") {
          for (let i = 0; i < (v.phase === "flying" ? 3 : 1); i++) {
            particles.push({ x: px - Math.cos(ang) * 26, y: py - Math.sin(ang) * 26, vx: -Math.cos(ang) * (40 + Math.random() * 60) + (Math.random() - 0.5) * 20,
              vy: -Math.sin(ang) * (40 + Math.random() * 60) + (Math.random() - 0.5) * 20, life: 1, size: 2 + Math.random() * 3 });
          }
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(px, py); ctx.rotate(ang);
        const scale = Math.max(1, Math.min(1.5, w / 330));
        ctx.scale(scale, scale);
        ctx.translate(-34, -16);
        ctx.shadowColor = "rgba(255,40,60,.9)"; ctx.shadowBlur = 16;
        if (sprite === "jet") {
          ctx.fillStyle = "#e11d2e"; ctx.fill(JET_BODY);
          ctx.fillStyle = "#ff3b4b"; ctx.fill(JET_WINGS);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#7a0010"; ctx.lineWidth = 1; ctx.stroke(JET_BODY); ctx.stroke(JET_WINGS);
          ctx.fillStyle = "#a7e8ff"; ctx.fill(JET_GLASS);
          // propeller blur
          ctx.fillStyle = "rgba(230,230,230,.55)";
          ctx.beginPath(); ctx.ellipse(63, 17, 1.6, 9 * Math.abs(Math.sin(now / 25)) + 2, 0, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = "#f1f5f9"; ctx.fill(ROCKET_BODY);
          ctx.fillStyle = "#ef4444"; ctx.fill(ROCKET_FINS);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "#475569"; ctx.lineWidth = 1; ctx.stroke(ROCKET_BODY);
          ctx.fillStyle = "#38bdf8"; ctx.fill(ROCKET_WINDOW);
          // flame
          const f = 10 + Math.random() * 8;
          const fl = ctx.createLinearGradient(6, 0, 6 - f, 0);
          fl.addColorStop(0, "#fff7ae"); fl.addColorStop(0.4, "#ff9d00"); fl.addColorStop(1, "rgba(255,40,0,0)");
          ctx.fillStyle = fl; ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(6 - f, 16); ctx.lineTo(6, 20); ctx.fill();
        }
        ctx.restore();
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.6;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,${Math.round(120 + 100 * p.life)},${Math.round(60 * p.life)},${p.life * 0.7})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - p.life * 0.4), 0, Math.PI * 2); ctx.fill();
      }
      if (particles.length > 400) particles.splice(0, particles.length - 400);

      // --- big multiplier
      const shown = v.phase === "ended" ? (v.endAt ?? 1) : Math.floor(m * 100) / 100;
      ctx.textAlign = "center";
      if (crashed) {
        ctx.fillStyle = "#ff4d5e"; ctx.font = "700 18px system-ui"; ctx.fillText(labelsRef.current.flewAway.toUpperCase(), w / 2, h * 0.38);
      }
      const pulse = v.phase === "flying" ? 1 + 0.02 * Math.sin(now / 120) : 1;
      ctx.save(); ctx.translate(w / 2, h * 0.5); ctx.scale(pulse, pulse);
      ctx.font = `900 ${Math.round(Math.min(84, w / 6))}px system-ui`;
      ctx.fillStyle = crashed ? "#ff4d5e" : v.phase === "ended" ? "#22c55e" : "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 14;
      ctx.fillText(`${shown.toFixed(2)}×`, 0, 0);
      ctx.restore();
      if (v.phase === "idle") {
        ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "14px system-ui";
        ctx.fillText(labelsRef.current.waiting, w / 2, h * 0.5 + 34);
      }
      ctx.textAlign = "start";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [view, sprite]);

  return <canvas ref={canvas} className="block size-full" aria-hidden />;
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
