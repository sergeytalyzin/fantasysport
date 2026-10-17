// Demo Provider: полностью детерминированные ТЕСТОВЫЕ матчи, линии и результаты.
// Одинаковые входные данные всегда дают одинаковую статистику — расчёт
// демо-прогнозов воспроизводим и проверяем.

import { createRng, poisson } from "../random.ts";
import type {
  DateRange,
  LeagueCode,
  MatchStatus,
  ProviderLeague,
  ProviderMatch,
  ProviderMatchResult,
  ProviderPlayer,
  ProviderPlayerProp,
  ProviderPlayerStats,
  ProviderSport,
  ProviderTeam,
  SportId,
  SportsDataProvider,
} from "../types.ts";
import { DEMO_LEAGUES, type DemoLeagueSeed, type DemoPlayerSeed, type DemoTeamSeed } from "./roster.ts";

/** components рынков из таблицы markets: sport → code → stat keys. */
export type MarketComponents = Partial<Record<SportId, Record<string, string[]>>>;

export interface DemoProviderOptions {
  marketComponents: MarketComponents;
  now?: () => Date;
  /** Вероятность того, что спортсмен не выйдет на матч. */
  dnpRate?: number;
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Круговая система для 4 команд: три тура по две пары.
const ROUNDS: [number, number][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

const SPORT_NAMES: Record<SportId, string> = {
  hockey: "Хоккей",
  football: "Футбол",
  basketball: "Баскетбол",
};

interface DemoMatch {
  externalId: string;
  league: DemoLeagueSeed;
  home: DemoTeamSeed;
  away: DemoTeamSeed;
  startsAt: Date;
}

const teamExternalId = (team: DemoTeamSeed) => `demo:team:${team.id}`;
const playerExternalId = (player: DemoPlayerSeed) => `demo:player:${player.id}`;

/** Номер московских суток от эпохи. */
function mskDayIndex(date: Date): number {
  return Math.floor((date.getTime() + MSK_OFFSET_MS) / DAY_MS);
}

function dayKey(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Линия по среднему значению: всегда x.5, чтобы исключить равенство. */
export function lineFromMean(mean: number, rng: () => number): number {
  let line = Math.floor(mean) + 0.5;
  if (mean >= 8) {
    const shift = rng();
    if (shift < 0.25) line -= 1;
    else if (shift > 0.75) line += 1;
  }
  return Math.max(0.5, line);
}

export class DemoProvider implements SportsDataProvider {
  readonly id = "demo";
  readonly capabilities = { lines: true, results: true };

  private readonly now: () => Date;
  private readonly dnpRate: number;

  constructor(private readonly options: DemoProviderOptions) {
    this.now = options.now ?? (() => new Date());
    this.dnpRate = options.dnpRate ?? 0.04;
  }

  async getSports(): Promise<ProviderSport[]> {
    return (Object.keys(SPORT_NAMES) as SportId[]).map((id) => ({
      id,
      externalId: `demo:sport:${id}`,
      name: SPORT_NAMES[id],
    }));
  }

  async getLeagues(): Promise<ProviderLeague[]> {
    return DEMO_LEAGUES.map((league) => ({
      code: league.code,
      sportId: league.sportId,
      externalId: `demo:league:${league.code}`,
      name: league.name,
    }));
  }

  async getMatches(range: DateRange): Promise<{ matches: ProviderMatch[]; teams: ProviderTeam[] }> {
    const matches: ProviderMatch[] = [];
    const teams = new Map<string, ProviderTeam>();
    for (let day = mskDayIndex(range.from) - 1; day <= mskDayIndex(range.to); day++) {
      for (const league of DEMO_LEAGUES) {
        for (let slot = 0; slot < league.kickoffs.length; slot++) {
          const match = this.buildMatch(league, day, slot);
          if (match.startsAt < range.from || match.startsAt > range.to) continue;
          matches.push(this.toProviderMatch(match));
          for (const team of [match.home, match.away]) {
            teams.set(team.id, this.toProviderTeam(team, league.sportId));
          }
        }
      }
    }
    return { matches, teams: [...teams.values()] };
  }

  async getPlayers({ matchExternalIds }: { matchExternalIds: string[] }): Promise<ProviderPlayer[]> {
    const players = new Map<string, ProviderPlayer>();
    for (const id of matchExternalIds) {
      const match = this.findMatch(id);
      if (!match) continue;
      for (const team of [match.home, match.away]) {
        for (const player of team.players) {
          players.set(player.id, {
            externalId: playerExternalId(player),
            sportId: match.league.sportId,
            teamExternalId: teamExternalId(team),
            fullName: player.name,
            position: player.position,
            jerseyNumber: player.number,
            photoUrl: null,
          });
        }
      }
    }
    return [...players.values()];
  }

  async getPlayerProps({ matchExternalIds }: { matchExternalIds: string[] }): Promise<ProviderPlayerProp[]> {
    const props: ProviderPlayerProp[] = [];
    for (const id of matchExternalIds) {
      const match = this.findMatch(id);
      if (!match) continue;
      const markets = this.options.marketComponents[match.league.sportId] ?? {};
      for (const player of [...match.home.players, ...match.away.players]) {
        for (const marketCode of player.markets) {
          const components = markets[marketCode];
          if (!components) continue;
          const mean = components.reduce((sum, key) => sum + (player.means[key] ?? 0), 0);
          const rng = createRng(`${match.externalId}:${player.id}:${marketCode}:line`);
          props.push({
            matchExternalId: match.externalId,
            playerExternalId: playerExternalId(player),
            marketCode,
            line: lineFromMean(mean, rng),
          });
        }
      }
    }
    return props;
  }

  async getPlayerStats({
    matchExternalId,
    force = false,
  }: {
    matchExternalId: string;
    force?: boolean;
  }): Promise<ProviderMatchResult | null> {
    const match = this.findMatch(matchExternalId);
    if (!match) return null;
    if (!force && this.statusOf(match) !== "FINISHED") return null;

    const players: ProviderPlayerStats[] = [];
    const teamGoals = { home: 0, away: 0 };
    for (const side of ["home", "away"] as const) {
      for (const player of match[side].players) {
        const stat = this.generateStats(match, player);
        players.push(stat);
        teamGoals[side] += stat.stats.goals ?? stat.stats.points ?? 0;
      }
    }

    const rng = createRng(`${match.externalId}:score`);
    const rest = { hockey: 1.3, football: 0.5, basketball: 58 }[match.league.sportId];
    return {
      matchExternalId: match.externalId,
      status: "FINISHED",
      homeScore: teamGoals.home + poisson(rng, rest),
      awayScore: teamGoals.away + poisson(rng, rest),
      confirmed: true,
      players,
    };
  }

  private generateStats(match: DemoMatch, player: DemoPlayerSeed): ProviderPlayerStats {
    const rng = createRng(`${match.externalId}:${player.id}:stats`);
    const id = playerExternalId(player);
    if (rng() < this.dnpRate) {
      return { playerExternalId: id, didPlay: false, stats: {} };
    }
    const m = player.means;
    const binomial = (n: number, p: number) => {
      let k = 0;
      for (let i = 0; i < n; i++) if (rng() < p) k++;
      return k;
    };
    const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 0);

    let stats: Record<string, number>;
    switch (match.league.sportId) {
      case "hockey": {
        const shots = poisson(rng, m.shots_on_goal);
        stats = {
          shots_on_goal: shots,
          goals: binomial(shots, ratio(m.goals, m.shots_on_goal)),
          assists: poisson(rng, m.assists),
          saves: poisson(rng, m.saves),
        };
        break;
      }
      case "football": {
        const shots = poisson(rng, m.shots);
        const onTarget = binomial(shots, ratio(m.shots_on_target, m.shots));
        stats = {
          shots,
          shots_on_target: onTarget,
          goals: binomial(onTarget, ratio(m.goals, m.shots_on_target)),
          passes: poisson(rng, m.passes),
        };
        break;
      }
      case "basketball": {
        const points = poisson(rng, m.points);
        stats = {
          points,
          rebounds: poisson(rng, m.rebounds),
          assists: poisson(rng, m.assists),
          threes_made: Math.min(poisson(rng, m.threes_made), Math.floor(points / 3)),
        };
        break;
      }
    }
    return { playerExternalId: id, didPlay: true, stats };
  }

  private buildMatch(league: DemoLeagueSeed, day: number, slot: number): DemoMatch {
    const [homeIdx, awayIdx] = ROUNDS[day % ROUNDS.length][slot % 2];
    const swap = Math.floor(day / ROUNDS.length) % 2 === 1;
    const [hours, minutes] = league.kickoffs[slot];
    return {
      externalId: `demo:${league.code}:${dayKey(day)}:${slot}`,
      league,
      home: league.teams[swap ? awayIdx : homeIdx],
      away: league.teams[swap ? homeIdx : awayIdx],
      startsAt: new Date(day * DAY_MS - MSK_OFFSET_MS + (hours * 60 + minutes) * 60_000),
    };
  }

  private findMatch(externalId: string): DemoMatch | null {
    const parsed = /^demo:([A-Z]+):(\d{4})(\d{2})(\d{2}):(\d+)$/.exec(externalId);
    if (!parsed) return null;
    const league = DEMO_LEAGUES.find((l) => l.code === (parsed[1] as LeagueCode));
    const slot = Number(parsed[5]);
    if (!league || slot >= league.kickoffs.length) return null;
    const day = Date.UTC(Number(parsed[2]), Number(parsed[3]) - 1, Number(parsed[4])) / DAY_MS;
    return this.buildMatch(league, day, slot);
  }

  private statusOf(match: DemoMatch): MatchStatus {
    const now = this.now().getTime();
    const start = match.startsAt.getTime();
    if (now < start) return "SCHEDULED";
    if (now < start + match.league.durationMinutes * 60_000) return "LIVE";
    return "FINISHED";
  }

  private toProviderMatch(match: DemoMatch): ProviderMatch {
    return {
      externalId: match.externalId,
      leagueCode: match.league.code,
      homeTeamExternalId: teamExternalId(match.home),
      awayTeamExternalId: teamExternalId(match.away),
      startsAt: match.startsAt.toISOString(),
      status: this.statusOf(match),
    };
  }

  private toProviderTeam(team: DemoTeamSeed, sportId: SportId): ProviderTeam {
    return {
      externalId: teamExternalId(team),
      sportId,
      name: team.name,
      shortName: team.shortName,
      abbr: team.abbr,
      color: team.color,
      logoUrl: null,
    };
  }
}
