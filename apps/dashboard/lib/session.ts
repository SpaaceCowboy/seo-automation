import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { ControlIdentity } from "@roco/shared/control";
export interface Session {
  token: string;
  csrf: string;
  identity: ControlIdentity;
  expiresAt: number;
}
interface Store {
  sessions: Map<string, Session>;
  loginAttempts: { count: number; reset: number };
}
const globalStore = globalThis as typeof globalThis & {
  rocoSessionStore?: Store;
};
const store = (globalStore.rocoSessionStore ??= {
  sessions: new Map(),
  loginAttempts: { count: 0, reset: 0 },
});
export const SESSION_COOKIE = "roco_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export function dashboardConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const origin = z
    .string()
    .url()
    .parse(env.DASHBOARD_ORIGIN ?? "http://127.0.0.1:3000");
  const api = z
    .string()
    .url()
    .parse(env.DASHBOARD_API_URL ?? "http://127.0.0.1:4000");
  for (const value of [origin, api]) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      !["http:", "https:"].includes(u.protocol)
    )
      throw new Error("Invalid dashboard origin configuration");
  }
  if (
    env.NODE_ENV === "production" &&
    !origin.startsWith("https://") &&
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)
  )
    throw new Error("Remote production dashboard requires HTTPS");
  if (
    env.NODE_ENV === "production" &&
    (!env.DASHBOARD_ORIGIN || !env.DASHBOARD_API_URL)
  )
    throw new Error(
      "Production dashboard requires explicit origin and API configuration",
    );
  return {
    origin: new URL(origin).origin,
    api: new URL(api).origin,
    secure: origin.startsWith("https://"),
  };
}
export function sameOrigin(request: Request, origin: string) {
  return request.headers.get("origin") === origin;
}
export function permitLogin(now = Date.now()) {
  if (now >= store.loginAttempts.reset)
    store.loginAttempts = { count: 0, reset: now + 60000 };
  return ++store.loginAttempts.count <= 20;
}
export function issueSession(
  token: string,
  identity: ControlIdentity,
  now = Date.now(),
) {
  for (const [id, s] of store.sessions)
    if (s.expiresAt <= now) store.sessions.delete(id);
  if (store.sessions.size >= 200) throw new Error("SESSION_CAPACITY");
  const id = randomBytes(32).toString("base64url"),
    session = {
      token,
      identity,
      csrf: randomBytes(32).toString("base64url"),
      expiresAt: now + SESSION_SECONDS * 1000,
    };
  store.sessions.set(id, session);
  return { id, session };
}
export function findSession(id: string | undefined, now = Date.now()) {
  if (!id) return null;
  const s = store.sessions.get(id);
  if (!s) return null;
  if (s.expiresAt <= now) {
    store.sessions.delete(id);
    return null;
  }
  return s;
}
export function endSession(id: string | undefined) {
  if (id) store.sessions.delete(id);
}
