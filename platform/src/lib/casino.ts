"use client";
import { supabaseBrowser } from "./supabase/client";

export interface CasinoGame {
  id: string; provider_id: string; name: string; category: string; tags: string[];
  description: Record<string, string>; rules: Record<string, string>; enabled: boolean;
  is_featured: boolean; is_new: boolean; edge_configurable: boolean; fixed_edge_note: string | null;
  certified_rtp: number | null; thumbnail: string | null; min_bet: number; max_bet: number; sort_order: number;
  casino_providers: { name: string; kind: string; status: string } | null;
  house_edge_settings: { edge_bps: number; min_bps: number; max_bps: number } | null;
}

export async function fetchGames() {
  const { data, error } = await supabaseBrowser().from("casino_games")
    .select("*, casino_providers(name, kind, status), house_edge_settings(edge_bps, min_bps, max_bps)")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((g: CasinoGame & { house_edge_settings: unknown }) => ({
    ...g,
    house_edge_settings: Array.isArray(g.house_edge_settings) ? g.house_edge_settings[0] ?? null : g.house_edge_settings,
  })) as CasinoGame[];
}

export async function fetchFavorites(userId: string) {
  const { data } = await supabaseBrowser().from("favorite_games").select("game_id").eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.game_id as string));
}

export function edgeLabel(g: CasinoGame) {
  if (g.house_edge_settings) return `${(g.house_edge_settings.edge_bps / 100).toFixed(2)}%`;
  return null;
}

export function inCategory(g: CasinoGame, cat: string, favorites: Set<string>) {
  switch (cat) {
    case "all": return true;
    case "featured": return g.is_featured;
    case "new": return g.is_new;
    case "favorites": return favorites.has(g.id);
    case "table": return g.category === "table";
    case "blackjack": case "roulette": case "baccarat": return g.tags.includes(cat);
    default: return g.category === cat || g.tags.includes(cat);
  }
}
