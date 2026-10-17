// Типы данных, приходящих из Supabase (PostgREST и RPC).
// Денежные суммы — копейки (bigint в БД, number в JSON).

export type SportId =
  | "hockey"
  | "football"
  | "basketball"
  | "dota"
  | "cs"
  | "tennis"
  | "volleyball"
  | "handball"
  | "baseball"
  | "american_football"
  | "mma"
  | "boxing"
  | "table_tennis"
  | "rugby"
  | "cricket"
  | "futsal"
  | "darts"
  | "snooker"
  | "lol"
  | "valorant";
export type PlayType = "POWER" | "FLEX";
export type PickDirection = "OVER" | "UNDER";
export type LineupStatus = "PENDING" | "WON" | "LOST" | "PARTIALLY_WON" | "VOID" | "REFUNDED";
export type SelectionResult = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "CANCELLED" | "POSTPONED";
export type ProjectionStatus = "OPEN" | "SUSPENDED" | "SETTLED" | "VOID";
export type WalletTxType =
  | "INITIAL_BONUS"
  | "MONTHLY_BONUS"
  | "PICK_STAKE"
  | "PICK_WIN"
  | "PICK_REFUND"
  | "ADMIN_ADJUSTMENT";
export type UserRole = "user" | "admin";

export interface Sport {
  id: SportId;
  name: string;
  sort_order: number;
}

export interface League {
  id: string;
  sport_id: SportId;
  code: string;
  name: string;
  short_name: string;
  sort_order: number;
  external_ids: Record<string, string>;
  is_active: boolean;
}

export interface Market {
  id: string;
  sport_id: SportId;
  code: string;
  name: string;
  short_name: string;
  components: string[];
  sort_order: number;
}

export interface TeamRef {
  id: string;
  name: string;
  short_name: string;
  abbr: string;
  color: string | null;
  logo_url: string | null;
}

export interface BoardProjection {
  id: string;
  line: number;
  status: ProjectionStatus;
  line_updated_at: string;
  market: Pick<Market, "id" | "code" | "name" | "short_name">;
  player: {
    id: string;
    full_name: string;
    position: string | null;
    jersey_number: number | null;
    photo_url: string | null;
    photo_source: string | null;
    photo_license: string | null;
    photo_author: string | null;
    photo_page_url: string | null;
    team: TeamRef | null;
  };
  match: {
    id: string;
    starts_at: string;
    status: MatchStatus;
    source: string;
    league: Pick<League, "code" | "short_name" | "sport_id">;
    home: TeamRef;
    away: TeamRef;
  };
}

export interface PayoutRule {
  id: string;
  play_type: PlayType;
  picks_count: number;
  correct_count: number;
  multiplier: number;
  is_active: boolean;
}

export interface AppSettings {
  initial_bonus_amount: number;
  monthly_bonus_amount: number;
  monthly_bonus_enabled: boolean;
  min_stake: number;
  max_stake: number;
  min_picks: number;
  max_picks: number;
  flex_min_picks: number;
}

export interface Wallet {
  user_id: string;
  balance: number;
  reserved: number;
  capital: number;
  funded_total: number;
  updated_at: string;
}

export interface WalletTransaction {
  id: number;
  user_id: string;
  type: WalletTxType;
  amount: number;
  balance_after: number;
  reserved_after: number;
  lineup_id: string | null;
  description: string | null;
  created_at: string;
}

export interface LineupSelection {
  id: string;
  projection_id: string;
  player_id: string;
  direction: PickDirection;
  line: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  market_name: string;
  league_code: string;
  match_starts_at: string;
  result: SelectionResult;
  actual_value: number | null;
  result_reason: string | null;
  player: {
    photo_url: string | null;
    photo_source: string | null;
    photo_license: string | null;
    photo_author: string | null;
    photo_page_url: string | null;
  } | null;
}

export interface Lineup {
  id: string;
  user_id: string;
  play_type: PlayType;
  picks_count: number;
  stake: number;
  multiplier: number;
  potential_payout: number;
  status: LineupStatus;
  applied_multiplier: number | null;
  payout: number | null;
  settled_at: string | null;
  settlement_note: string | null;
  created_at: string;
  selections: LineupSelection[];
}

export interface Profile {
  id: string;
  nickname: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

export interface ProfileSummary {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  balance: number;
  reserved: number;
  capital: number;
  profit: number;
  overall_rank: number;
  total_players: number;
  lineups_total: number;
  lineups_settled: number;
  lineups_won: number;
  win_rate: number | null;
}

export interface OverallLeaderboardRow {
  rank: number;
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  capital: number;
  profit: number;
  lineups_total: number;
  lineups_settled: number;
  win_rate: number | null;
}

export interface MonthlyLeaderboardRow {
  rank: number;
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  profit: number;
  lineups_settled: number;
  lineups_won: number;
  is_archived: boolean;
}

export interface LeaderboardPeriod {
  year: number;
  month: number;
  is_current: boolean;
}

export interface MyRank {
  rank: number;
  total_players: number;
  capital?: number;
  profit: number;
  lineups_settled?: number;
}
