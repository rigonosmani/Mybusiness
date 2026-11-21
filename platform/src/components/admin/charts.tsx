"use client";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n";
import { formatCredits } from "@/lib/money";

/** Daily staked vs returned (units → Cr). */
export function DailyChart({ data }: { data: { day: string; staked: number; returned: number }[] }) {
  const { t } = useI18n();
  const rows = data.map((d) => ({ day: d.day.slice(5), staked: d.staked / 100, returned: d.returned / 100 }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="hsl(186 90% 52%)" stopOpacity={0.35} /><stop offset="1" stopColor="hsl(186 90% 52%)" stopOpacity={0} /></linearGradient>
            <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="hsl(38 96% 58%)" stopOpacity={0.3} /><stop offset="1" stopColor="hsl(38 96% 58%)" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(226 24% 21%)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "hsl(222 16% 64%)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "hsl(222 16% 64%)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip contentStyle={{ background: "hsl(227 33% 11%)", border: "1px solid hsl(226 24% 21%)", borderRadius: 8 }}
            formatter={(v) => formatCredits(Math.round(Number(v ?? 0) * 100))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="staked" name={t.admin.wagered} stroke="hsl(186 90% 52%)" fill="url(#gs)" strokeWidth={2} />
          <Area type="monotone" dataKey="returned" name={t.admin.returnedToPlayers} stroke="hsl(38 96% 58%)" fill="url(#gr)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PeriodSelect({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const { t } = useI18n();
  return (
    <select value={days} onChange={(e) => onChange(Number(e.target.value))} aria-label={t.common.period}
      className="h-9 rounded-md border border-input bg-panel-2 px-3 text-sm">
      <option value={7}>{t.common.last7}</option>
      <option value={30}>{t.common.last30}</option>
      <option value={90}>{t.common.last90}</option>
    </select>
  );
}

export function periodArgs(days: number) {
  return { p_from: new Date(Date.now() - days * 86_400_000).toISOString(), p_to: new Date().toISOString() };
}
