import { describe, expect, it } from "vitest";
import { initialKey, matchPlayers, normalizeName, teamMatches } from "./matching.ts";

describe("normalizeName", () => {
  it("убирает диакритику, регистр и меняет «Фамилия, Имя»", () => {
    expect(normalizeName("Nikita Kučerov")).toBe("nikita kucerov");
    expect(normalizeName("Cunningham, Cade")).toBe("cade cunningham");
    expect(normalizeName("Jean-Gabriel Pageau")).toBe("jean gabriel pageau");
    expect(initialKey("F. Svechkov")).toBe("f svechkov");
    expect(initialKey("Fyodor Svechkov")).toBe("f svechkov");
  });
});

describe("matchPlayers", () => {
  const theirs = [
    { fullName: "Alex Ovechkin", id: 1 },
    { fullName: "Dylan Strome", id: 2 },
    { fullName: "Tom Wilson", id: 3 },
    { fullName: "Logan Thompson", id: 4 },
  ];

  it("сопоставляет полное имя, инициал + фамилию и формат «Фамилия, Имя»", () => {
    const { matched, unmatched } = matchPlayers(
      [
        { player_id: "a", full_name: "Ovechkin, Alexander" },
        { player_id: "b", full_name: "Dylan Strome" },
        { player_id: "c", full_name: "T. Wilson" },
      ],
      theirs,
    );
    expect(unmatched).toEqual([]);
    expect(matched.get("a")?.id).toBe(1);
    expect(matched.get("b")?.id).toBe(2);
    expect(matched.get("c")?.id).toBe(3);
  });

  it("не угадывает при неоднозначности", () => {
    const { matched, unmatched } = matchPlayers(
      [{ player_id: "x", full_name: "J. Hughes" }],
      [
        { fullName: "Jack Hughes" },
        { fullName: "Jake Hughes" },
      ],
    );
    expect(matched.size).toBe(0);
    expect(unmatched).toEqual([{ player_id: "x", full_name: "J. Hughes" }]);
  });

  it("отсутствующий у провайдера спортсмен остаётся несопоставленным", () => {
    const { unmatched } = matchPlayers([{ player_id: "z", full_name: "Connor McDavid" }], theirs);
    expect(unmatched).toHaveLength(1);
  });
});

describe("teamMatches", () => {
  it("по аббревиатуре и по значимым словам названия", () => {
    expect(teamMatches({ name: "Colorado Avalanche", abbr: "COL" }, { names: ["Avalanche"], abbr: "COL" })).toBe(true);
    expect(teamMatches({ name: "Colorado Avalanche", abbr: "CLR" }, { names: ["Colorado Avalanche"] })).toBe(true);
    expect(teamMatches({ name: "Vegas Golden Knights" }, { names: ["Golden Knights", "Vegas"] })).toBe(true);
    expect(teamMatches({ name: "Manchester City" }, { names: ["Manchester United"] })).toBe(false);
    expect(teamMatches({ name: "FC Barcelona" }, { names: ["Barcelona"] })).toBe(true);
  });
});
