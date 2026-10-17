// Статистика НХЛ из публичного API лиги (api-web.nhle.com), ключ не нужен.
// Официальной документации нет; структура проверена на реальных ответах:
//   GET /v1/score/{YYYY-MM-DD}                 — игры дня (gameState, команды)
//   GET /v1/gamecenter/{id}/boxscore           — playerByGameStats: forwards/defense/goalies
//   GET /v1/gamecenter/{id}/play-by-play       — rosterSpots: полные имена
// gameState "OFF" — результат официальный (до этого "LIVE"/"CRIT"/"FINAL").

import { ProviderHttpError, type LeagueCode } from "../types.ts";
import type { AwaitingMatch, ExternalGame, ExternalGameResult, ExternalPlayerLine, ResultsProvider } from "./types.ts";

interface NhlName {
  default: string;
}

interface NhlScoreGame {
  id: number;
  gameState: string;
  startTimeUTC: string;
  homeTeam: { abbrev: string; name?: NhlName; placeName?: NhlName };
  awayTeam: { abbrev: string; name?: NhlName; placeName?: NhlName };
}

interface NhlSkater {
  playerId: number;
  goals?: number;
  assists?: number;
  sog?: number;
  toi?: string;
}

interface NhlGoalie {
  playerId: number;
  saves?: number;
  goals?: number;
  assists?: number;
  toi?: string;
}

interface NhlBoxscore {
  id: number;
  gameState: string;
  homeTeam: { score?: number };
  awayTeam: { score?: number };
  playerByGameStats?: Record<"homeTeam" | "awayTeam", { forwards: NhlSkater[]; defense: NhlSkater[]; goalies: NhlGoalie[] }>;
}

interface NhlPlayByPlay {
  rosterSpots?: { playerId: number; firstName: NhlName; lastName: NhlName }[];
}

const FINAL_STATES = new Set(["OFF"]);
const played = (toi: string | undefined) => Boolean(toi) && toi !== "00:00";

export class NhlResultsProvider implements ResultsProvider {
  readonly id = "nhl";
  readonly leagues: LeagueCode[] = ["NHL"];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api-web.nhle.com/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async findGames(match: AwaitingMatch): Promise<ExternalGame[]> {
    // Дата в /score — дата по времени лиги, поэтому проверяем соседние сутки.
    const start = new Date(match.starts_at).getTime();
    const days = new Set([-1, 0].map((d) => new Date(start + d * 86_400_000).toISOString().slice(0, 10)));
    const games: ExternalGame[] = [];
    for (const day of days) {
      const data = await this.get<{ games?: NhlScoreGame[] }>(`score/${day}`);
      for (const g of data.games ?? []) {
        const team = (t: NhlScoreGame["homeTeam"]) => ({
          abbr: t.abbrev,
          names: [t.name?.default, t.placeName?.default && t.name?.default ? `${t.placeName.default} ${t.name.default}` : null].filter(
            (x): x is string => Boolean(x),
          ),
        });
        games.push({ gameId: String(g.id), startsAt: g.startTimeUTC, home: team(g.homeTeam), away: team(g.awayTeam) });
      }
    }
    return games;
  }

  async getGameResult(gameId: string): Promise<ExternalGameResult | null> {
    const box = await this.get<NhlBoxscore>(`gamecenter/${gameId}/boxscore`);
    if (!box.playerByGameStats) return null;
    const pbp = await this.get<NhlPlayByPlay>(`gamecenter/${gameId}/play-by-play`);
    const names = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, `${r.firstName.default} ${r.lastName.default}`]));

    const players: ExternalPlayerLine[] = [];
    for (const side of ["homeTeam", "awayTeam"] as const) {
      const team = box.playerByGameStats[side];
      for (const s of [...team.forwards, ...team.defense]) {
        const fullName = names.get(s.playerId);
        if (!fullName) continue;
        players.push({
          fullName,
          didPlay: played(s.toi),
          stats: { goals: s.goals ?? 0, assists: s.assists ?? 0, shots_on_goal: s.sog ?? 0, saves: 0 },
        });
      }
      for (const g of team.goalies) {
        const fullName = names.get(g.playerId);
        if (!fullName) continue;
        // У вратарей в boxscore обычно нет голов и передач — тогда это 0.
        players.push({
          fullName,
          didPlay: played(g.toi),
          stats: { goals: g.goals ?? 0, assists: g.assists ?? 0, shots_on_goal: 0, saves: g.saves ?? 0 },
        });
      }
    }

    return {
      gameId: String(box.id),
      final: FINAL_STATES.has(box.gameState),
      homeScore: box.homeTeam.score ?? null,
      awayScore: box.awayTeam.score ?? null,
      players,
    };
  }

  /** Сырой play-by-play для live-экрана. */
  getPlayByPlay<T>(gameId: string): Promise<T> {
    return this.get<T>(`gamecenter/${gameId}/play-by-play`);
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${path}`;
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new ProviderHttpError(this.id, res.status, url, await res.text());
    return (await res.json()) as T;
  }
}
