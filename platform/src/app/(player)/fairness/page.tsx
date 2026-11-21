"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/feedback";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n";
import { rpc } from "@/lib/rpc";
import { cardLabel, floats, outcomes, sha256Hex } from "@/lib/fairness";
import { formatDateTime } from "@/lib/utils";

interface Fairness {
  active: { server_seed_hash: string; client_seed: string; nonce: number };
  revealed: { server_seed_hash: string; server_seed: string; client_seed: string; nonce: number; revealed_at: string }[];
}

const GAMES = ["dice", "limbo", "crash", "coinflip", "roulette", "plinko", "keno", "mines", "hilo", "blackjack", "baccarat", "videopoker"] as const;

function Verifier() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [game, setGame] = useState<string>(params.get("game") ?? "dice");
  const [serverSeed, setServerSeed] = useState("");
  const [clientSeed, setClientSeed] = useState(params.get("client") ?? "");
  const [nonce, setNonce] = useState(params.get("nonce") ?? "0");
  const [edge, setEdge] = useState(params.get("edge") ?? "100");
  const extra = (() => { try { return JSON.parse(params.get("params") ?? "{}"); } catch { return {}; } })();
  const [rows, setRows] = useState(String(extra.rows ?? 16));
  const [mines, setMines] = useState(String(extra.mines ?? 3));
  const [out, setOut] = useState<string>("");
  const [hashOk, setHashOk] = useState<boolean | null>(null);
  const fairness = useQuery({ queryKey: ["fairness"], queryFn: () => rpc<Fairness>("get_fairness") });

  // Auto-fill the revealed server seed matching the round's committed hash.
  useEffect(() => {
    const h = params.get("hash");
    const hit = fairness.data?.revealed.find((r) => r.server_seed_hash === h);
    if (hit) setServerSeed(hit.server_seed);
  }, [fairness.data, params]);

  async function compute() {
    const seed = { serverSeed: serverSeed.trim(), clientSeed: clientSeed.trim(), nonce: Number(nonce) };
    const expected = params.get("hash");
    setHashOk(expected ? (await sha256Hex(seed.serverSeed)) === expected : null);
    const fs = await floats(seed, 64);
    const cards = (n: number) => Array.from({ length: n }, (_, i) => cardLabel(outcomes.card(fs, i))).map((c) => c.rank + c.suit).join(" ");
    const r: Record<string, () => unknown> = {
      dice: () => outcomes.dice(fs),
      limbo: () => `${outcomes.limbo(fs, Number(edge))}×`,
      crash: () => `${outcomes.crash(fs, Number(edge))}×`,
      coinflip: () => outcomes.coinflip(fs),
      roulette: () => outcomes.roulette(fs),
      plinko: () => JSON.stringify(outcomes.plinko(fs, Number(rows))),
      keno: () => outcomes.keno(fs).join(", "),
      mines: () => outcomes.mines(fs, Number(mines)).join(", "),
      hilo: () => cards(12),
      blackjack: () => cards(10),
      baccarat: () => cards(6),
      videopoker: () => outcomes.videopoker(fs).map((c) => { const l = cardLabel(c); return l.rank + l.suit; }).join(" "),
    };
    setOut(String(r[game]()));
  }

  return (
    <Card>
      <CardHeader title={t.fairness.verifyTitle} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.fairness.gameLabel}><Select value={game} onChange={(e) => setGame(e.target.value)}>{GAMES.map((g) => <option key={g} value={g}>{g}</option>)}</Select></Field>
        <Field label={t.fairness.nonce}><Input inputMode="numeric" value={nonce} onChange={(e) => setNonce(e.target.value)} /></Field>
        <Field label={t.fairness.serverSeed}><Input value={serverSeed} onChange={(e) => setServerSeed(e.target.value)} className="font-mono text-xs" /></Field>
        <Field label={t.fairness.clientSeed}><Input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} className="font-mono text-xs" /></Field>
        {["limbo", "crash"].includes(game) && <Field label={t.fairness.edgeBps}><Input value={edge} onChange={(e) => setEdge(e.target.value)} /></Field>}
        {game === "plinko" && <Field label={t.fairness.rows}><Input value={rows} onChange={(e) => setRows(e.target.value)} /></Field>}
        {game === "mines" && <Field label={t.fairness.mines}><Input value={mines} onChange={(e) => setMines(e.target.value)} /></Field>}
      </div>
      <Button className="mt-4" onClick={compute} disabled={!serverSeed}>{t.fairness.compute}</Button>
      {hashOk !== null && (
        <p className={`mt-3 flex items-center gap-2 text-sm ${hashOk ? "text-success" : "text-danger"}`}>
          {hashOk ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} {hashOk ? t.fairness.verifyOk : t.fairness.verifyBad}
        </p>
      )}
      {out && <div className="mt-3"><p className="text-xs text-muted-foreground">{t.fairness.output}</p><Textarea readOnly value={out} /></div>}
    </Card>
  );
}

function FairnessContent() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fairness"], queryFn: () => rpc<Fairness>("get_fairness") });
  const [client, setClient] = useState("");
  const rotate = useAction(() => rpc("rotate_seed", { p_new_client_seed: client.trim() || null }), {
    onSuccess: () => { setClient(""); qc.invalidateQueries({ queryKey: ["fairness"] }); },
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={<span className="flex items-center gap-2"><ShieldCheck className="text-primary" /> {t.fairness.title}</span>} description={t.fairness.howItWorks} />
      <Card>
        <CardHeader title={t.fairness.activeSeed} />
        {q.isLoading ? <SkeletonRows rows={3} /> : q.data && (
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t.fairness.serverHash}</dt><dd className="break-all font-mono text-xs">{q.data.active.server_seed_hash}</dd></div>
            <div className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-muted-foreground">{t.fairness.clientSeed}</dt><dd className="break-all font-mono text-xs">{q.data.active.client_seed}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t.fairness.nonce}</dt><dd className="font-mono text-xs">{q.data.active.nonce}</dd></div>
            </div>
          </dl>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input placeholder={t.fairness.newClientSeed} value={client} onChange={(e) => setClient(e.target.value)} maxLength={64} />
          <Button onClick={() => rotate.run()} loading={rotate.pending}><RefreshCw /> {t.fairness.rotate}</Button>
        </div>
      </Card>
      <Verifier />
      <Card>
        <CardHeader title={t.fairness.revealed} />
        <div className="space-y-3">
          {q.data?.revealed.length === 0 && <p className="text-sm text-muted-foreground">{t.common.empty}</p>}
          {q.data?.revealed.map((r) => (
            <div key={r.server_seed_hash} className="rounded-md border border-border bg-panel-2 p-3 text-xs">
              <p className="mb-1 text-muted-foreground">{formatDateTime(r.revealed_at, locale)} · {t.fairness.clientSeed}: <span className="font-mono">{r.client_seed}</span> · nonce 0–{r.nonce - 1}</p>
              <p className="break-all font-mono"><span className="text-muted-foreground">{t.fairness.serverSeed}: </span>{r.server_seed}</p>
              <p className="break-all font-mono text-muted-foreground">sha256: {r.server_seed_hash}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function FairnessPage() {
  return <Suspense><FairnessContent /></Suspense>;
}
