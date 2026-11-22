/**
 * Hot Fruits 5 symbols — original vector artwork (glossy, high-contrast, classic
 * fruit-machine look). Every symbol is drawn in a 100×100 box.
 */
import { useId, type ReactNode } from "react";

function Shine({ x, y, rx = 9, ry = 5, rot = -30 }: { x: number; y: number; rx?: number; ry?: number; rot?: number }) {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fff" opacity=".55" transform={`rotate(${rot} ${x} ${y})`} />;
}

function Frame({ children, glow }: { children: ReactNode; glow: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" className="size-full drop-shadow-[0_3px_3px_rgba(0,0,0,.55)]" aria-hidden>
      <defs>
        <radialGradient id={`g${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={glow} stopOpacity=".45" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="52" r="48" fill={`url(#g${id})`} />
      {children}
    </svg>
  );
}

function Cherry() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#ff2a4d">
      <defs>
        <radialGradient id={`c${id}`} cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#ff6b7d" /><stop offset=".55" stopColor="#e0102f" /><stop offset="1" stopColor="#6d0012" /></radialGradient>
      </defs>
      <path d="M33 62 C40 38 52 22 66 14 M70 60 C66 40 64 26 66 14" stroke="#2f7d1f" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M66 14 C76 8 88 12 92 20 C82 24 72 22 66 14Z" fill="#3fae2a" stroke="#1d5c12" strokeWidth="1.5" />
      <circle cx="32" cy="70" r="19" fill={`url(#c${id})`} stroke="#4a000b" strokeWidth="2" />
      <circle cx="69" cy="68" r="19" fill={`url(#c${id})`} stroke="#4a000b" strokeWidth="2" />
      <Shine x={25} y={62} /><Shine x={62} y={60} />
    </Frame>
  );
}

function Lemon() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#ffe100">
      <defs>
        <radialGradient id={`l${id}`} cx="38%" cy="32%" r="72%"><stop offset="0" stopColor="#fff7a1" /><stop offset=".5" stopColor="#ffd60a" /><stop offset="1" stopColor="#b88400" /></radialGradient>
      </defs>
      <path d="M10 52 C10 30 30 18 50 18 C70 18 90 30 90 52 C90 74 70 84 50 84 C30 84 10 74 10 52Z" fill={`url(#l${id})`} stroke="#7a5600" strokeWidth="2" transform="rotate(-18 50 51)" />
      <path d="M8 58 L2 62 L9 64Z M92 44 L98 40 L91 38Z" fill="#c99700" />
      <Shine x={34} y={36} rx={12} ry={6} />
    </Frame>
  );
}

function Orange() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#ff8a00">
      <defs>
        <radialGradient id={`o${id}`} cx="36%" cy="32%" r="70%"><stop offset="0" stopColor="#ffc46b" /><stop offset=".5" stopColor="#ff8200" /><stop offset="1" stopColor="#a34200" /></radialGradient>
      </defs>
      <circle cx="50" cy="55" r="36" fill={`url(#o${id})`} stroke="#6b2b00" strokeWidth="2" />
      {[[38, 46], [58, 40], [64, 62], [42, 68], [52, 56], [30, 60]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.4" fill="#b85200" opacity=".7" />)}
      <path d="M50 20 C46 12 40 10 34 12 C38 18 44 20 50 20Z" fill="#3fae2a" stroke="#1d5c12" strokeWidth="1.2" />
      <circle cx="50" cy="20" r="3" fill="#5a3200" />
      <Shine x={36} y={40} rx={11} ry={6} />
    </Frame>
  );
}

function Plum() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#a63dff">
      <defs>
        <radialGradient id={`p${id}`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor="#d79bff" /><stop offset=".5" stopColor="#7a1fc7" /><stop offset="1" stopColor="#2b0050" /></radialGradient>
      </defs>
      <path d="M50 20 C76 20 86 42 84 60 C82 78 66 88 50 88 C34 88 18 78 16 60 C14 42 24 20 50 20Z" fill={`url(#p${id})`} stroke="#22003d" strokeWidth="2" />
      <path d="M50 24 C46 44 46 66 52 86" stroke="#3b0a66" strokeWidth="2" fill="none" opacity=".6" />
      <path d="M50 22 C52 14 56 10 60 8" stroke="#5a3200" strokeWidth="3" strokeLinecap="round" />
      <path d="M56 14 C66 6 78 10 80 18 C70 20 62 20 56 14Z" fill="#3fae2a" stroke="#1d5c12" strokeWidth="1.2" />
      <Shine x={34} y={40} rx={10} ry={6} />
    </Frame>
  );
}

function Grapes() {
  const id = useId().replace(/:/g, "");
  const berries = [[36, 34], [52, 32], [68, 36], [30, 50], [46, 48], [62, 50], [76, 50], [40, 64], [56, 64], [70, 64], [48, 78], [62, 78], [55, 90]];
  return (
    <Frame glow="#4cff5a">
      <defs>
        <radialGradient id={`gr${id}`} cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#d6ff9e" /><stop offset=".5" stopColor="#59c21a" /><stop offset="1" stopColor="#1e5a00" /></radialGradient>
      </defs>
      <path d="M52 22 C50 14 52 8 58 4" stroke="#5a3200" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M54 16 C40 6 24 12 22 22 C34 26 46 24 54 16Z" fill="#3fae2a" stroke="#1d5c12" strokeWidth="1.2" />
      {berries.map(([x, y], i) => (
        <g key={i}><circle cx={x} cy={y} r="9.5" fill={`url(#gr${id})`} stroke="#164400" strokeWidth="1.4" /><circle cx={x - 3} cy={y - 3} r="2.4" fill="#fff" opacity=".6" /></g>
      ))}
    </Frame>
  );
}

function Melon() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#ff3d6e">
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6f8e" /><stop offset="1" stopColor="#e3002f" /></linearGradient>
      </defs>
      <path d="M6 30 L94 30 C94 66 74 90 50 90 C26 90 6 66 6 30Z" fill="#1f8a2b" stroke="#0b3d10" strokeWidth="2" />
      <path d="M12 30 L88 30 C88 60 70 82 50 82 C30 82 12 60 12 30Z" fill="#e9ffd8" />
      <path d="M16 30 L84 30 C84 56 68 76 50 76 C32 76 16 56 16 30Z" fill={`url(#m${id})`} />
      {[[34, 44], [50, 50], [66, 44], [42, 60], [58, 60], [50, 38]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="2.4" ry="3.6" fill="#1a0a0a" transform={`rotate(${(i % 3 - 1) * 20} ${x} ${y})`} />
      ))}
      <path d="M16 31 L84 31" stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
    </Frame>
  );
}

function Seven() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame glow="#ff2200">
      <defs>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff7a5c" /><stop offset=".45" stopColor="#ff1500" /><stop offset="1" stopColor="#8a0000" /></linearGradient>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset=".5" stopColor="#ffc400" /><stop offset="1" stopColor="#a66b00" /></linearGradient>
      </defs>
      <path d="M18 14 L84 14 L84 30 C66 48 56 66 52 90 L30 90 C34 66 46 46 60 32 L18 32Z" fill={`url(#s${id})`} stroke={`url(#sg${id})`} strokeWidth="5" strokeLinejoin="round" />
      <path d="M24 19 L78 19" stroke="#fff" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

function StarScatter() {
  const id = useId().replace(/:/g, "");
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 19 : 44;
    return `${50 + r * Math.cos(a)},${53 + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <Frame glow="#ffd000">
      <defs>
        <radialGradient id={`st${id}`} cx="45%" cy="35%" r="70%"><stop offset="0" stopColor="#fffbd0" /><stop offset=".45" stopColor="#ffd000" /><stop offset="1" stopColor="#b36b00" /></radialGradient>
      </defs>
      <polygon points={pts} fill={`url(#st${id})`} stroke="#7a4300" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points={pts} fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1" transform="translate(50 53) scale(.78) translate(-50 -53)" />
      <text x="50" y="60" textAnchor="middle" fontSize="13" fontWeight="900" fill="#7a2a00" fontFamily="system-ui">★</text>
    </Frame>
  );
}

const MAP: Record<string, () => ReactNode> = {
  cherry: Cherry, lemon: Lemon, orange: Orange, plum: Plum, grapes: Grapes, melon: Melon, seven: Seven, star: StarScatter,
};

export function FruitSymbol({ id }: { id: string }) {
  const C = MAP[id];
  return C ? <C /> : null;
}

export const FRUIT_IDS = Object.keys(MAP);
