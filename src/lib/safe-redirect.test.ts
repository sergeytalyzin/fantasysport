import { expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

it("safeRedirectPath пропускает только внутренние пути", () => {
  expect(safeRedirectPath("/lineups")).toBe("/lineups");
  expect(safeRedirectPath("//evil.com")).toBe("/");
  expect(safeRedirectPath("/\\evil.com")).toBe("/");
  expect(safeRedirectPath("https://evil.com")).toBe("/");
  expect(safeRedirectPath(null)).toBe("/");
});
