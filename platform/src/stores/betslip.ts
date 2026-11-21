"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SlipSelection {
  outcomeId: string;
  fixtureId: string;
  eventName: string;
  marketKey: string;
  label: string;
  odds: string; // offered odds as quoted (string, 2 decimals)
  live: boolean;
}

interface SlipState {
  selections: SlipSelection[];
  mode: "singles" | "accumulator";
  stake: string;
  open: boolean;
  toggle: (s: SlipSelection) => void;
  remove: (outcomeId: string) => void;
  updateOdds: (outcomeId: string, odds: string) => void;
  clear: () => void;
  setMode: (m: "singles" | "accumulator") => void;
  setStake: (s: string) => void;
  setOpen: (o: boolean) => void;
}

export const useBetSlip = create<SlipState>()(
  persist(
    (set) => ({
      selections: [],
      mode: "singles",
      stake: "1",
      open: false,
      toggle: (s) =>
        set((st) => {
          if (st.selections.some((x) => x.outcomeId === s.outcomeId)) {
            return { selections: st.selections.filter((x) => x.outcomeId !== s.outcomeId) };
          }
          // One selection per market: replace a sibling outcome of the same fixture+market.
          const others = st.selections.filter((x) => !(x.fixtureId === s.fixtureId && x.marketKey === s.marketKey));
          const selections = [...others, s].slice(-20);
          return { selections, mode: selections.length > 1 && st.mode === "singles" && st.selections.length === 0 ? "accumulator" : st.mode };
        }),
      remove: (id) => set((st) => ({ selections: st.selections.filter((x) => x.outcomeId !== id) })),
      updateOdds: (id, odds) => set((st) => ({ selections: st.selections.map((x) => (x.outcomeId === id ? { ...x, odds } : x)) })),
      clear: () => set({ selections: [] }),
      setMode: (mode) => set({ mode }),
      setStake: (stake) => set({ stake }),
      setOpen: (open) => set({ open }),
    }),
    { name: "kometa-betslip", partialize: (s) => ({ selections: s.selections, mode: s.mode, stake: s.stake }) },
  ),
);
