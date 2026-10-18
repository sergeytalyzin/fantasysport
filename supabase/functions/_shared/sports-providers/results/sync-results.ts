// Конвейер внешних результатов: матч из БД → игра провайдера → статистика →
// сопоставление спортсменов → RPC ingest_match_stats.
// Матч подтверждается автоматически, только если сопоставлены ВСЕ спортсмены
// с линиями. Иначе статистика сохраняется без подтверждения, и решение
// принимает администратор (несопоставленные имена видны в админке).

import { matchPlayers, teamMatches } from "./matching.ts";
import type { AwaitingMatch, ExternalGame, ResultsProvider } from "./types.ts";

export interface ExternalResultsSink {
  awaiting(leagueCodes: string[], limit: number, sportIds: string[]): Promise<AwaitingMatch[]>;
  ingest(matchId: string, provider: string, gameId: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface ExternalResultsReport {
  checked: number;
  confirmed: number;
  needs_review: number;
  pending: number;
  not_found: number;
  errors: string[];
}

/** Максимальная разница времени начала между источниками. */
const START_TOLERANCE_MS = 3 * 60 * 60 * 1000;
const LOOSE_START_TOLERANCE_MS = 15 * 60 * 1000;

export function pickGame(match: AwaitingMatch, games: ExternalGame[]): { game: ExternalGame; swapped: boolean } | null {
  const start = new Date(match.starts_at).getTime();
  const candidates = games.flatMap((g) => {
    if (Math.abs(new Date(g.startsAt).getTime() - start) > START_TOLERANCE_MS) return [];
    if (teamMatches(match.home, g.home) && teamMatches(match.away, g.away)) return [{ game: g, swapped: false }];
    // У некоторых источников (OddsPapi) хозяева не гарантированы.
    if (teamMatches(match.home, g.away) && teamMatches(match.away, g.home)) return [{ game: g, swapped: true }];
    return [];
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return null;

  // Источники пишут команды по-разному («Rennes» / «Stade Rennais FC», «Moskva» / «Moscow»).
  // Запасное правило: то же время начала (±15 мин) и совпадение хотя бы одной команды —
  // команда не может играть два матча одновременно. Кандидат должен быть единственным.
  const loose = games.flatMap((g) => {
    if (Math.abs(new Date(g.startsAt).getTime() - start) > LOOSE_START_TOLERANCE_MS) return [];
    if (teamMatches(match.home, g.home) || teamMatches(match.away, g.away)) return [{ game: g, swapped: false }];
    if (teamMatches(match.home, g.away) || teamMatches(match.away, g.home)) return [{ game: g, swapped: true }];
    return [];
  });
  return loose.length === 1 ? loose[0] : null;
}

export async function syncExternalResults(
  providers: ResultsProvider[],
  sink: ExternalResultsSink,
  { limit = 10 }: { limit?: number } = {},
): Promise<ExternalResultsReport> {
  const report: ExternalResultsReport = { checked: 0, confirmed: 0, needs_review: 0, pending: 0, not_found: 0, errors: [] };
  const byLeague = new Map<string, ResultsProvider>();
  const bySport = new Map<string, ResultsProvider>();
  for (const p of providers) {
    for (const l of p.leagues) if (!byLeague.has(l)) byLeague.set(l, p);
    for (const s of p.sports ?? []) if (!bySport.has(s)) bySport.set(s, p);
  }
  if (byLeague.size === 0 && bySport.size === 0) return report;

  const matches = await sink.awaiting([...byLeague.keys()], limit, [...bySport.keys()]);
  for (const match of matches) {
    const provider = byLeague.get(match.league_code) ?? (match.sport_id ? bySport.get(match.sport_id) : undefined);
    if (!provider) continue;
    report.checked++;
    const label = `${match.league_code} ${match.home.name} — ${match.away.name}`;
    try {
      let gameId = match.link?.provider === provider.id ? match.link.external_game_id : null;
      let swapped = false;
      if (!gameId) {
        const picked = pickGame(match, await provider.findGames(match));
        if (!picked) {
          report.not_found++;
          continue;
        }
        gameId = picked.game.gameId;
        swapped = picked.swapped;
      }

      const result = await provider.getGameResult(gameId);
      if (!result || !result.final) {
        report.pending++;
        continue;
      }

      const { matched, unmatched } = matchPlayers(match.players, result.players);
      const confirmed = unmatched.length === 0;
      await sink.ingest(match.match_id, provider.id, gameId, {
        status: "FINISHED",
        home_score: swapped ? result.awayScore : result.homeScore,
        away_score: swapped ? result.homeScore : result.awayScore,
        confirmed,
        unmatched: unmatched.map((u) => u.full_name),
        players: [...matched].map(([playerId, line]) => ({ player_id: playerId, did_play: line.didPlay, stats: line.stats })),
      });
      if (confirmed) report.confirmed++;
      else {
        report.needs_review++;
        report.errors.push(`${label}: не сопоставлены ${unmatched.map((u) => u.full_name).join(", ")}`);
      }
    } catch (e) {
      report.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
