import { describe, expect, it } from "vitest";
import { resolveBackAction } from "./back-policy";

/**
 * The back-navigation contract:
 *
 * - an open overlay always takes the press,
 * - otherwise any non-Home location returns straight to Home,
 * - otherwise the platform exits.
 */
describe("resolveBackAction", () => {
  it("closes an open modal first, on any screen", () => {
    expect(resolveBackAction(1, "/")).toBe("pop_modal");
    expect(resolveBackAction(2, "/calendar")).toBe("pop_modal");
    expect(resolveBackAction(1, "/profile")).toBe("pop_modal");
    expect(resolveBackAction(3, "/section")).toBe("pop_modal");
  });

  it("returns to Home from any top-level tab that is not Home", () => {
    expect(resolveBackAction(0, "/calendar")).toBe("replace_home");
    expect(resolveBackAction(0, "/hobbies")).toBe("replace_home");
    expect(resolveBackAction(0, "/profile")).toBe("replace_home");
  });

  it("returns to Home from a nested child screen", () => {
    expect(resolveBackAction(0, "/section")).toBe("replace_home");
    expect(resolveBackAction(0, "/remainder")).toBe("replace_home");
    expect(resolveBackAction(0, "/occasional")).toBe("replace_home");
  });

  it("exits only from Home with nothing open", () => {
    expect(resolveBackAction(0, "/")).toBe("exit");
  });

  it("normalises trailing slashes and empty paths", () => {
    expect(resolveBackAction(0, "/profile/")).toBe("replace_home");
    expect(resolveBackAction(0, "/")).toBe("exit");
    expect(resolveBackAction(0, "")).toBe("exit");
  });

  it("never treats a tab switch as a history walk", () => {
    // Profile → Back must resolve to Home, never to Calendar.
    expect(resolveBackAction(0, "/profile")).toBe("replace_home");
  });
});
