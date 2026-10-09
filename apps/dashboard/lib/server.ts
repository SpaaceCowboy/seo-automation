import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import {
  STAFF_COOKIE,
  staffAuthConfig,
  staffAuthorization,
  validateStaffSession,
  StaffAuthError,
} from "@roco/shared/staff-auth";
import { identitySchema } from "@roco/shared/control";
import { backend, ApiError } from "./backend";
import { SESSION_COOKIE, findSession, endSession } from "./session";
export async function authenticatedSession() {
  const config = staffAuthConfig();
  if (config) {
    const cookie = (await cookies()).get(STAFF_COOKIE)?.value;
    if (!cookie) return null;
    try {
      const token = staffAuthorization(cookie);
      const staff = await validateStaffSession(token, config, randomUUID());
      if (!staff.seoActorId) throw new ApiError(403, "SEO_ACCESS_NOT_GRANTED");
      const identity = identitySchema.parse(
        await backend("/control/session", token),
      );
      return {
        token,
        identity,
        csrf: staff.csrf,
        expiresAt: Date.parse(staff.expiresAt),
      };
    } catch (error) {
      if (
        (error instanceof StaffAuthError && error.status === 401) ||
        (error instanceof ApiError && error.status === 401)
      )
        return null;
      throw error;
    }
  }
  const id = (await cookies()).get(SESSION_COOKIE)?.value,
    s = findSession(id);
  if (!s) return null;
  try {
    s.identity = identitySchema.parse(
      await backend("/control/session", s.token),
    );
    return s;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      endSession(id);
      return null;
    }
    throw error;
  }
}
