import { expect, it } from "vitest";
import { pairColors, teamColor } from "./team-color";

it("цвет команды стабилен, у соперников цвета различаются", () => {
  const wsh = { color: null, name: "Washington Capitals", abbr: "WSH" };
  expect(teamColor(wsh)).toBe(teamColor({ ...wsh }));
  const [a, b] = pairColors({ color: "#123456", name: "A" }, { color: "#123456", name: "B" });
  expect(a).not.toBe(b);
  const [c, d] = pairColors({ color: "#ff0000", name: "A" }, { color: "#0000ff", name: "B" });
  expect([c, d]).toEqual(["#ff0000", "#0000ff"]);
});
