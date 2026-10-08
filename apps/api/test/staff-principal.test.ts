import { createHash } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolvePrincipal } from "../src/staff-principal.js";
import { staffAuthorization } from "@roco/shared/staff-auth";
const actorId = "22222222-2222-4222-8222-222222222222";
const credentials = [
  {
    actorId,
    roles: ["VIEWER" as const],
    hash: createHash("sha256").update("test-service-credential").digest(),
  },
];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("staff principal mapping", () => {
  it("preserves service authentication", async () => {
    await expect(
      resolvePrincipal("Bearer test-service-credential", "test", credentials),
    ).resolves.toMatchObject({ actorId, roles: ["VIEWER"] });
    await expect(
      resolvePrincipal("Bearer wrong", "test", credentials),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("takes permissions only from the SEO registry and rejects unmapped actors", async () => {
    vi.stubEnv(
      "STAFF_AUTH_URL",
      "https://authority.test/api/admin/staff-session",
    );
    vi.stubEnv("STAFF_AUTH_SERVICE_SECRET", "s".repeat(48));
    const session = {
      userId: "11111111-1111-4111-8111-111111111111",
      authUserId: "fixture",
      seoActorId: actorId,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      csrf: "c".repeat(43),
      roles: ["ADMIN"],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(session)));
    await expect(
      resolvePrincipal(
        staffAuthorization("fixture.signed"),
        "test",
        credentials,
      ),
    ).resolves.toMatchObject({ actorId, roles: ["VIEWER"] });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...session, seoActorId: null })),
    );
    await expect(
      resolvePrincipal(
        staffAuthorization("fixture.signed"),
        "test",
        credentials,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
