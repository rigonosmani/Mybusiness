export interface WagerStats { sports_staked: number; sports_returned: number; casino_staked: number; casino_returned: number }

export interface AdminOverview {
  balance: number;
  players: { total: number; active: number; suspended: number };
  players_balance: number;
  distributed_total: number; returned_total: number; distributed_period: number; returned_period: number; received_total: number;
  bets: { open: number; settled: number; open_exposure: number };
  wagering: WagerStats;
  daily: { day: string; staked: number; returned: number }[];
  games: { game_id: string; rounds: number; staked: number; paid: number }[];
}

export interface SuperOverview {
  admins: { total: number; active: number; suspended: number; deactivated: number };
  players_total: number;
  credits: { my_balance: number; issued_total: number; admin_available: number; player_held: number; allocated_total: number;
    reclaimed_total: number; allocated_period: number; reclaimed_period: number; house_casino: number; house_sportsbook: number };
  wagering: WagerStats;
  daily: { day: string; staked: number; returned: number }[];
  sportsbook: { open_bets: number; open_stake: number; open_exposure: number; settled_period: number };
  games: { game_id: string; rounds: number; staked: number; paid: number; realized_rtp: number | null }[];
  games_availability: { enabled: number; disabled: number };
  integrations: { id: string; name: string; enabled: boolean; status: string; last_success_at: string | null; requests_remaining: number | null }[];
  per_admin: { admin_id: string; username: string; players: number; wagered: number }[];
}

export const houseResult = (w: WagerStats) => w.sports_staked + w.casino_staked - w.sports_returned - w.casino_returned;
