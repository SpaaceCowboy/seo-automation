import {
  agentCodeSchema,
  runtimeSnapshotSchema,
  type RuntimeSnapshot,
} from "../src/control.js";
export function statusSnapshot(): RuntimeSnapshot {
  return runtimeSnapshotSchema.parse({
    agentsEnabled: true,
    policyKnown: true,
    agents: agentCodeSchema.options.map((code) => ({
      code,
      enabled: code === "SUPERVISOR",
      model: code === "SUPERVISOR" ? "fixture-model" : null,
      reasoning: code === "SUPERVISOR" ? "medium" : null,
    })),
    openai: { keyConfigured: true, model: "fixture-model" },
    google: { siteId: null, GSC: false, GA4: false, PAGESPEED: false },
    limits: {
      monthlyNanousd: "20000000000",
      runNanousd: "100000000",
      minScore: 75,
    },
  });
}
import {
  integrationsStatusSchema,
  type IntegrationsStatus,
} from "../src/control.js";
export function statusFixture(): IntegrationsStatus {
  const snapshot = statusSnapshot(),
    at = "2026-10-08T12:00:00.000Z";
  return integrationsStatusSchema.parse({
    observedAt: at,
    worker: { state: "ONLINE", lastSeen: at },
    agents: snapshot.agents,
    openai: {
      configured: true,
      model: "fixture-model",
      status: "VERIFIED",
      lastChecked: at,
      errorCode: null,
      httpStatus: 200,
      durationMs: 1,
      checkId: null,
      canCheck: true,
      cooldownSeconds: 0,
    },
    budget: {
      month: "2026-10",
      limitNanousd: "20000000000",
      bookedNanousd: "0",
      remainingNanousd: "20000000000",
      runNanousd: "100000000",
      minScore: 75,
    },
    google: (["GSC", "GA4", "PAGESPEED"] as const).map((provider) => ({
      provider,
      configured: false,
      scheduledForSelectedSite: null,
      latestAttempt: null,
      lastSuccess: null,
    })),
  });
}
