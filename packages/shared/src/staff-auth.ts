import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { createLogger } from "./index.js";
const logger = createLogger({
  level: "info",
  service: "staff-auth",
  environment: process.env.NODE_ENV ?? "development",
});

export const STAFF_COOKIE = "__Secure-roco-staff.session_token";
const staffSessionSchema = z.object({
  userId: z.string().uuid(),
  authUserId: z.string().min(1),
  seoActorId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime(),
  csrf: z.string().min(32).max(256),
});
export class StaffAuthError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function staffAuthConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = Boolean(
    env.STAFF_AUTH_URL ||
    env.STAFF_AUTH_SERVICE_SECRET ||
    env.STAFF_AUTH_SERVICE_SECRET_FILE,
  );
  if (!configured) return null;
  if (
    !env.STAFF_AUTH_URL ||
    (env.STAFF_AUTH_SERVICE_SECRET && env.STAFF_AUTH_SERVICE_SECRET_FILE)
  )
    throw new Error("Incomplete staff authentication configuration");
  const url = new URL(env.STAFF_AUTH_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/admin/staff-session"
  )
    throw new Error("Invalid staff authentication URL");
  let secret = env.STAFF_AUTH_SERVICE_SECRET;
  if (env.STAFF_AUTH_SERVICE_SECRET_FILE) {
    try {
      if (statSync(env.STAFF_AUTH_SERVICE_SECRET_FILE).size > 256)
        throw new Error();
      secret = readFileSync(env.STAFF_AUTH_SERVICE_SECRET_FILE, "utf8").trim();
    } catch {
      throw new Error("Staff authentication secret is unavailable");
    }
  }
  if (!secret || secret.length < 32 || secret.length > 256)
    throw new Error("Invalid staff authentication secret");
  return { url: url.href, secret };
}
export function staffAuthorization(cookie: string): string {
  if (!/^[A-Za-z0-9_.%+/=-]{1,1024}$/.test(cookie))
    throw new StaffAuthError(401, "UNAUTHORIZED");
  return `StaffSession ${Buffer.from(`${STAFF_COOKIE}=${cookie}`).toString("base64url")}`;
}
export function decodeStaffAuthorization(header: string): string {
  if (!/^StaffSession [A-Za-z0-9_-]{1,1500}$/.test(header))
    throw new StaffAuthError(401, "UNAUTHORIZED");
  const encoded = header.slice(13),
    cookie = Buffer.from(encoded, "base64url").toString("utf8");
  if (
    Buffer.from(cookie).toString("base64url") !== encoded ||
    !cookie.startsWith(`${STAFF_COOKIE}=`) ||
    !/^[A-Za-z0-9_.%+/=-]{1,1024}$/.test(cookie.slice(STAFF_COOKIE.length + 1))
  )
    throw new StaffAuthError(401, "UNAUTHORIZED");
  return cookie;
}
export async function validateStaffSession(
  header: string,
  config: NonNullable<ReturnType<typeof staffAuthConfig>>,
  correlationId: string,
  fetcher: typeof fetch = fetch,
) {
  const cookie = decodeStaffAuthorization(header),
    started = Date.now();
  let status = 503;
  try {
    const response = await fetcher(config.url, {
      headers: {
        authorization: `Bearer ${config.secret}`,
        cookie,
        "x-correlation-id": correlationId,
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    if (!response.ok)
      throw new StaffAuthError(
        [401, 403].includes(status) ? 401 : 503,
        [401, 403].includes(status) ? "UNAUTHORIZED" : "STAFF_AUTH_UNAVAILABLE",
      );
    const session = staffSessionSchema.parse(await response.json());
    if (Date.parse(session.expiresAt) <= Date.now())
      throw new StaffAuthError(401, "UNAUTHORIZED");
    return session;
  } catch (error) {
    if (error instanceof StaffAuthError) throw error;
    throw new StaffAuthError(503, "STAFF_AUTH_UNAVAILABLE");
  } finally {
    // Read-only checks are retried by the next dashboard request. Never retry mutations here.
    logger.info({
      event: "staff.session_validation",
      correlationId,
      status,
      latencyMs: Date.now() - started,
    });
  }
}
