// Единый реестр ключей TanStack Query — для точечной инвалидации.
export const queryKeys = {
  sports: ["sports"] as const,
  leagues: ["leagues"] as const,
  markets: ["markets"] as const,
  settings: ["app-settings"] as const,
  payoutRules: ["payout-rules"] as const,
  board: (filters: { sport: string | null; league: string | null; matchId?: string | null }) => ["board", filters] as const,
  boardAll: ["board"] as const,
  wallet: (userId: string) => ["wallet", userId] as const,
  walletAll: ["wallet"] as const,
  transactions: (userId: string) => ["transactions", userId] as const,
  transactionsAll: ["transactions"] as const,
  lineups: (userId: string, tab: string) => ["lineups", userId, tab] as const,
  lineupsAll: ["lineups"] as const,
  profileSummary: (userId: string) => ["profile-summary", userId] as const,
  profileSummaryAll: ["profile-summary"] as const,
  bonusGrants: (userId: string) => ["bonus-grants", userId] as const,
  leaderboardOverall: (search: string, limit: number) => ["leaderboard", "overall", search, limit] as const,
  leaderboardMonthly: (year: number, month: number, search: string, limit: number) =>
    ["leaderboard", "monthly", year, month, search, limit] as const,
  leaderboardPeriods: ["leaderboard", "periods"] as const,
  myRank: (kind: string, userId: string, year?: number, month?: number) =>
    ["leaderboard", "me", kind, userId, year, month] as const,
  leaderboardAll: ["leaderboard"] as const,
};
