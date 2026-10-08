import { createHash, timingSafeEqual } from "node:crypto";
import {
  staffAuthConfig,
  validateStaffSession,
  StaffAuthError,
} from "@roco/shared/staff-auth";
import { WorkflowError, type Principal, type Role } from "@roco/workflow";
export async function resolvePrincipal(
  header: string | undefined,
  correlationId: string,
  credentials: { hash: Buffer; actorId: string; roles: Role[] }[],
): Promise<Principal> {
  if (header?.startsWith("StaffSession ")) {
    const config = staffAuthConfig();
    if (!config) throw new WorkflowError("UNAUTHORIZED");
    try {
      const session = await validateStaffSession(header, config, correlationId);
      const identities = credentials.filter(
        (c) => c.actorId === session.seoActorId,
      );
      if (!identities.length) throw new WorkflowError("UNAUTHORIZED");
      // The SEO service remains authoritative for roles. Conflicting mappings fail closed.
      const roles = identities[0]!.roles;
      if (
        identities.some(
          (i) => [...i.roles].sort().join() !== [...roles].sort().join(),
        )
      )
        throw new WorkflowError("UNAUTHORIZED");
      return { actorId: identities[0]!.actorId, roles, correlationId };
    } catch (error) {
      if (error instanceof StaffAuthError) throw new WorkflowError(error.code);
      throw error;
    }
  }
  if (!header?.startsWith("Bearer ")) throw new WorkflowError("UNAUTHORIZED");
  const hash = createHash("sha256").update(header.slice(7)).digest();
  const identity = credentials.find((c) => timingSafeEqual(c.hash, hash));
  if (!identity) throw new WorkflowError("UNAUTHORIZED");
  return { actorId: identity.actorId, roles: identity.roles, correlationId };
}
