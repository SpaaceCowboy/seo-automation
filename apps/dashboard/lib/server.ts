import "server-only";
import { cookies } from "next/headers";
import { identitySchema } from "@roco/shared/control";
import { backend, ApiError } from "./backend";
import { SESSION_COOKIE, findSession, endSession } from "./session";
export async function authenticatedSession() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value,
    s = findSession(id);
  if (!s) return null;
  try {
    s.identity = identitySchema.parse(
      await backend("/control/session", s.token),
    );
    return s;
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      endSession(id);
      return null;
    }
    throw error;
  }
}
