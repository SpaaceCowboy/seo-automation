import { describe, it, expect } from "vitest";
import {
  issueSession,
  findSession,
  endSession,
  dashboardConfig,
  sameOrigin,
  permitLogin,
} from "../lib/session";
import { allowedControlPath } from "../lib/paths";
import { formatMetric, errorMessage } from "../lib/presentation";
const identity = {
  actorId: "11111111-1111-4111-8111-111111111111",
  displayName: "Operator",
  roles: ["OPERATOR"],
};
describe("private dashboard boundary", () => {
  it("expires and revokes opaque sessions; cookies do not contain credentials", () => {
    const { id, session } = issueSession(
      "secret-never-in-cookie",
      identity,
      100,
    );
    expect(id).not.toContain("secret");
    expect(session.csrf).not.toBe(id);
    expect(findSession(id, 101)).toEqual(session);
    expect(findSession(id, session.expiresAt)).toBeNull();
    const second = issueSession("private", identity);
    endSession(second.id);
    expect(findSession(second.id)).toBeNull();
  });
  it("requires an exact configured origin and HTTPS for remote production", () => {
    expect(
      sameOrigin(
        new Request("http://localhost", {
          headers: { origin: "https://evil.test" },
        }),
        "http://localhost",
      ),
    ).toBe(false);
    expect(() =>
      dashboardConfig({
        NODE_ENV: "production",
        DASHBOARD_ORIGIN: "http://internal.test",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      dashboardConfig({ DASHBOARD_API_URL: "http://user:secret@localhost" }),
    ).toThrow();
    expect(
      dashboardConfig({ DASHBOARD_ORIGIN: "https://control.example.test" })
        .secure,
    ).toBe(true);
  });
  it("limits login attempts without trusting forwarded client addresses", () => {
    const now = Date.now() + 120000;
    for (let i = 0; i < 20; i++) expect(permitLogin(now)).toBe(true);
    expect(permitLogin(now)).toBe(false);
    expect(permitLogin(now + 60000)).toBe(true);
  });
  it("allowlists reads and workflow mutations without allowing upstream escapes", () => {
    const site = identity.actorId;
    expect(
      allowedControlPath(`/sites/${site}/control/opportunities`, "GET"),
    ).toBe(true);
    expect(
      allowedControlPath(
        `/sites/${site}/workflow/recommendations/${site}/decisions`,
        "POST",
      ),
    ).toBe(true);
    for (const path of [
      "/health",
      "/../../secret",
      "https://evil.test",
      "/sites/bad/control/issues",
      `/sites/${site}/crawls`,
    ])
      expect(allowedControlPath(path, "POST")).toBe(false);
  });
  it("preserves unknown vs zero metrics and gives actionable conflicts", () => {
    expect(formatMetric("clicks", null)).toBe("Unavailable");
    expect(formatMetric("clicks", 0)).toBe("0");
    expect(formatMetric("ctr", 0.02)).toBe("2%");
    expect(errorMessage("INVALID_RECOMMENDATION_TRANSITION")).toContain(
      "Refresh",
    );
  });
});
