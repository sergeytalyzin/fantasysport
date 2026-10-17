// Статистика Dota 2 из OpenDota (api.opendota.com) — бесплатно, без ключа.
// Проверено на реальных ответах:
//   GET /api/proMatches        — последние 100 про-карт: series_id, series_type,
//                                radiant/dire team id и name, radiant_win, start_time
//   GET /api/matches/{id}      — игроки карты: name (про-ник), personaname, kills, isRadiant
// Матч (серия) = несколько карт с одним series_id. Убийства игрока суммируются
// по всем картам серии. Команды меняются сторонами между картами, поэтому
// победы считаются по id команды. series_type: 0 — BO1, 1 — BO3, 2 — BO5, 3 — BO2.

import { type LeagueCode, ProviderHttpError, type SportId } from "../types.ts";
import type { ExternalGame, ExternalGameResult, ExternalPlayerLine, ResultsProvider } from "./types.ts";

export interface OpenDotaProMatch {
  match_id: number;
  series_id: number;
  series_type: number;
  start_time: number;
  radiant_team_id: number | null;
  dire_team_id: number | null;
  radiant_name: string | null;
  dire_name: string | null;
  radiant_win: boolean;
}

export interface OpenDotaMatch {
  match_id: number;
  radiant_team_id?: number | null;
  dire_team_id?: number | null;
  players: { account_id: number | null; name: string | null; personaname: string | null; kills: number; isRadiant: boolean }[];
}

const WINS_NEEDED: Record<number, number> = { 0: 1, 1: 2, 2: 3 };

/** Серия завершена: одна команда набрала нужное число побед (BO2 — сыграны обе карты). */
export function seriesFinished(maps: OpenDotaProMatch[]): boolean {
  if (maps.length === 0) return false;
  const type = maps[0].series_type;
  if (type === 3) return maps.length >= 2;
  const wins = new Map<number, number>();
  for (const m of maps) {
    const winner = m.radiant_win ? m.radiant_team_id : m.dire_team_id;
    if (winner != null) wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return Math.max(0, ...wins.values()) >= (WINS_NEEDED[type] ?? 1);
}

export class OpenDotaResultsProvider implements ResultsProvider {
  readonly id = "opendota";
  readonly leagues: LeagueCode[] = [];
  /** Любые турниры Dota 2. */
  readonly sports: SportId[] = ["dota"];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private proMatches: Promise<OpenDotaProMatch[]> | null = null;

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.opendota.com/api").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Серии из последних про-карт (список запрашивается один раз за запуск). */
  async findGames(): Promise<ExternalGame[]> {
    const series = new Map<number, OpenDotaProMatch[]>();
    for (const m of await this.recent()) {
      if (!m.series_id) continue;
      series.set(m.series_id, [...(series.get(m.series_id) ?? []), m]);
    }
    return [...series.entries()].map(([id, maps]) => {
      const first = [...maps].sort((a, b) => a.start_time - b.start_time)[0];
      return {
        gameId: String(id),
        startsAt: new Date(first.start_time * 1000).toISOString(),
        home: { names: [first.radiant_name ?? ""] },
        away: { names: [first.dire_name ?? ""] },
      };
    });
  }

  async getGameResult(seriesId: string): Promise<ExternalGameResult | null> {
    const maps = (await this.recent())
      .filter((m) => String(m.series_id) === seriesId)
      .sort((a, b) => a.start_time - b.start_time);
    if (maps.length === 0) return null;
    // «Хозяева» серии — команда, игравшая за Radiant на первой карте (так же в findGames).
    const homeTeam = maps[0].radiant_team_id;
    if (!seriesFinished(maps)) {
      return { gameId: seriesId, final: false, homeScore: null, awayScore: null, players: [] };
    }

    const totals = new Map<string, ExternalPlayerLine>();
    for (const map of maps) {
      const details = await this.get<OpenDotaMatch>(`matches/${map.match_id}`);
      for (const p of details.players) {
        const fullName = (p.name ?? p.personaname ?? "").trim();
        if (!fullName) continue;
        const key = p.account_id ? String(p.account_id) : fullName;
        const line = totals.get(key) ?? { fullName, didPlay: true, stats: { kills: 0 } };
        line.stats.kills += p.kills ?? 0;
        totals.set(key, line);
      }
    }

    const wins = (team: number | null) =>
      maps.filter((m) => (m.radiant_win ? m.radiant_team_id : m.dire_team_id) === team).length;
    const awayTeam = maps[0].dire_team_id;
    return {
      gameId: seriesId,
      final: true,
      homeScore: wins(homeTeam),
      awayScore: wins(awayTeam),
      players: [...totals.values()],
    };
  }

  private recent(): Promise<OpenDotaProMatch[]> {
    this.proMatches ??= this.get<OpenDotaProMatch[]>("proMatches");
    return this.proMatches;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${path}`;
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new ProviderHttpError(this.id, res.status, url, await res.text());
    return (await res.json()) as T;
  }
}
