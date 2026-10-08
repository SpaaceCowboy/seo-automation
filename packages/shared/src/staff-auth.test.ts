import { describe, it, expect, vi } from "vitest";
import {
  staffAuthConfig,
  staffAuthorization,
  decodeStaffAuthorization,
  validateStaffSession,
  STAFF_COOKIE,
} from "./staff-auth.js";
const config = {
  url: "https://authority.test/api/admin/staff-session",
  secret: "test-service-key-".repeat(3),
};
const authorization = staffAuthorization("test.signed-cookie");
const session = {
  userId: "11111111-1111-4111-8111-111111111111",
  authUserId: "fixture",
  seoActorId: "22222222-2222-4222-8222-222222222222",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  csrf: "c".repeat(43),
};
describe("shared staff session boundary", () => {
  it("requires complete configuration and a pinned HTTPS endpoint", () => {
    expect(staffAuthConfig({})).toBeNull();
    for (const env of [
      { STAFF_AUTH_URL: config.url },
      { STAFF_AUTH_SERVICE_SECRET: config.secret },
      {
        STAFF_AUTH_URL: "http://authority.test/api/admin/staff-session",
        STAFF_AUTH_SERVICE_SECRET: config.secret,
      },
      {
        STAFF_AUTH_URL: "https://authority.test/other",
        STAFF_AUTH_SERVICE_SECRET: config.secret,
      },
    ])
      expect(() => staffAuthConfig(env)).toThrow();
    expect(
      staffAuthConfig({
        STAFF_AUTH_URL: config.url,
        STAFF_AUTH_SERVICE_SECRET: config.secret,
      }),
    ).toEqual(config);
  });
  it("forwards only the shared cookie and rejects cookie/header injection", () => {
    expect(
      decodeStaffAuthorization(staffAuthorization("test.signature+/=")),
    ).toBe(`${STAFF_COOKIE}=test.signature+/=`);
    expect(decodeStaffAuthorization(authorization)).toBe(
      `${STAFF_COOKIE}=test.signed-cookie`,
    );
    for (const value of ["x; other=secret", "x\r\nHost: evil", ""])
      expect(() => staffAuthorization(value)).toThrow();
    expect(() =>
      decodeStaffAuthorization(
        `StaffSession ${Buffer.from("other_cookie=anything").toString("base64url")}`,
      ),
    ).toThrow();
  });
  it("validates expiry, rejects revoked sessions and fails closed on authority outages", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(session));
    await expect(
      validateStaffSession(authorization, config, "test", fetcher),
    ).resolves.toEqual(session);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: { cookie: `${STAFF_COOKIE}=test.signed-cookie` },
    });
    await expect(
      validateStaffSession(
        authorization,
        config,
        "test",
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      validateStaffSession(
        authorization,
        config,
        "test",
        vi.fn().mockRejectedValue(new Error("network")),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      validateStaffSession(
        authorization,
        config,
        "test",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ ...session, expiresAt: new Date(0).toISOString() }),
          ),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      validateStaffSession(
        authorization,
        config,
        "test",
        vi.fn().mockResolvedValue(Response.json({ csrf: "broken" })),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
