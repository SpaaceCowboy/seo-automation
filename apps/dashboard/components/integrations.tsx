"use client";
import { useEffect, useState, useCallback } from "react";
import {
  integrationsStatusSchema,
  type IntegrationsStatus,
} from "@roco/shared/control";
import { displayDate, errorMessage } from "../lib/presentation";

const agentNames = {
  SUPERVISOR: "SEO Supervisor",
  TECHNICAL: "Technical SEO",
  KEYWORD: "Opportunity / Keyword",
  CONTENT: "Content",
  INTERNAL_LINKING: "Internal Linking",
};
const providerNames = {
  GSC: "Google Search Console",
  GA4: "Google Analytics 4",
  PAGESPEED: "PageSpeed Insights",
};
const connectionNames = {
  NOT_CHECKED: "Not checked",
  NOT_CONFIGURED: "Setup required",
  QUEUED: "Check queued",
  RUNNING: "Checking access",
  VERIFIED: "Key/model access verified",
  FAILED: "Check failed",
  STALE: "Check is stale",
};
function money(value: string | null, locale: string) {
  if (value === null) return "Unknown";
  const n = BigInt(value),
    whole = n / 1000000000n,
    fraction = (n % 1000000000n) / 100000n;
  return `${new Intl.NumberFormat(locale).format(whole)}${locale === "fa-IR" ? "٫" : "."}${new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 4 }).format(fraction)} USD`;
}
export function Integrations({
  siteId,
  csrf,
  operator,
  refresh,
  locale,
}: {
  siteId: string;
  csrf: string;
  operator: boolean;
  refresh: number;
  locale: string;
}) {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [checking, setChecking] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/control/control/integrations${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""}`,
          { cache: "no-store", ...(signal ? { signal } : {}) },
        );
        const data: unknown = await response.json();
        if (!response.ok)
          throw new Error(errorMessage((data as { error: string }).error));
        const parsed = integrationsStatusSchema.parse(data);
        if (!signal?.aborted) {
          setStatus(parsed);
          setError("");
        }
      } catch (e) {
        if (!signal?.aborted) {
          setStatus(null);
          setError(
            e instanceof Error
              ? e.message
              : "Integration status is unavailable.",
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [siteId],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(abort.signal);
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void load(abort.signal);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, refresh]);
  useEffect(() => {
    if (!status || !["QUEUED", "RUNNING"].includes(status.openai.status))
      return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(abort.signal);
    }, 2000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [status, load]);
  async function check() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch(
        "/api/control/control/integrations/openai/check",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: "{}",
        },
      );
      const data: unknown = await response.json();
      if (!response.ok)
        throw new Error(errorMessage((data as { error: string }).error));
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connection check could not be started.",
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <section
      className="integration-view"
      aria-label="Integration availability"
      aria-busy={loading}
    >
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry status</button>
        </div>
      )}
      {loading && <p role="status">Loading integration status…</p>}
      {!loading && status && (
        <>
          <div className="integration-worker">
            <strong>Worker: {status.worker.state.toLowerCase()}</strong>
            <span>
              Last heartbeat:{" "}
              {status.worker.lastSeen
                ? displayDate(status.worker.lastSeen, locale)
                : "Not reported"}
            </span>
          </div>
          <div className="integration-grid">
            <article className="integration-card">
              <div className="integration-card-heading">
                <h2>OpenAI</h2>
                <span
                  className={`integration-status integration-${status.openai.status.toLowerCase()}`}
                >
                  {connectionNames[status.openai.status]}
                </span>
              </div>
              <p>
                Model: <bdi>{status.openai.model ?? "Not reported"}</bdi>
              </p>
              <p>
                Last check:{" "}
                {status.openai.lastChecked
                  ? displayDate(status.openai.lastChecked, locale)
                  : "No completed check"}
              </p>
              {status.openai.errorCode && (
                <p role="status">{errorMessage(status.openai.errorCode)}</p>
              )}
              {operator && (
                <button
                  className="integration-check"
                  onClick={() => void check()}
                  disabled={checking || !status.openai.canCheck}
                >
                  {checking ? "Starting check…" : "Check connection"}
                </button>
              )}
              {status.openai.cooldownSeconds > 0 && (
                <p className="muted">
                  Next check in{" "}
                  {new Intl.NumberFormat(locale).format(
                    status.openai.cooldownSeconds,
                  )}{" "}
                  seconds.
                </p>
              )}
              <p className="integration-note">
                Verifies key/model access without paid inference. Account
                credit, inference permissions and recommendation quality are not
                verified.
              </p>
            </article>
            <article className="integration-card">
              <h2>Application budget</h2>
              <dl className="integration-budget">
                <div>
                  <dt>Monthly limit</dt>
                  <dd dir="ltr">{money(status.budget.limitNanousd, locale)}</dd>
                </div>
                <div>
                  <dt>Booked / reserved</dt>
                  <dd dir="ltr">
                    {money(status.budget.bookedNanousd, locale)}
                  </dd>
                </div>
                <div>
                  <dt>Remaining app budget</dt>
                  <dd dir="ltr">
                    {money(status.budget.remainingNanousd, locale)}
                  </dd>
                </div>
                <div>
                  <dt>Per-analysis ceiling</dt>
                  <dd dir="ltr">{money(status.budget.runNanousd, locale)}</dd>
                </div>
              </dl>
              <p className="integration-note">
                UTC month {status.budget.month}. Conservative application
                estimates, not OpenAI account balance.
              </p>
              <p>
                Minimum opportunity score:{" "}
                {status.budget.minScore === null
                  ? "Unknown"
                  : new Intl.NumberFormat(locale).format(
                      status.budget.minScore,
                    )}
              </p>
            </article>
          </div>
          <article className="integration-card">
            <h2>Agent availability</h2>
            <p className="integration-note">
              Activation is separate from connection checks and analysis
              history.
            </p>
            <div className="integration-roster">
              {status.agents.map((agent) => (
                <div className="integration-agent" key={agent.code}>
                  <div>
                    <strong>{agentNames[agent.code]}</strong>
                    <p>
                      <bdi>{agent.model ?? "No model configured"}</bdi>
                      {agent.reasoning && ` · ${agent.reasoning} reasoning`}
                    </p>
                  </div>
                  <span
                    className={`integration-status ${agent.enabled ? "integration-verified" : ""}`}
                  >
                    {agent.enabled === null
                      ? "Unknown"
                      : agent.enabled
                        ? "Enabled"
                        : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          </article>
          <div className="integration-grid integration-google">
            {status.google.map((provider) => (
              <article className="integration-card" key={provider.provider}>
                <div className="integration-card-heading">
                  <h2>{providerNames[provider.provider]}</h2>
                  <span className="integration-status">
                    {provider.configured === null
                      ? "Configuration unknown"
                      : provider.configured
                        ? "Configured"
                        : "Setup required"}
                  </span>
                </div>
                <p>
                  Latest attempt:{" "}
                  {provider.latestAttempt
                    ? `${provider.latestAttempt.status}${provider.latestAttempt.dimensionSet ? ` · ${provider.latestAttempt.dimensionSet}` : ""}`
                    : "No stored attempts"}
                </p>
                {provider.latestAttempt && (
                  <p>{displayDate(provider.latestAttempt.at, locale)}</p>
                )}
                <p>
                  Last successful import:{" "}
                  {provider.lastSuccess
                    ? displayDate(provider.lastSuccess, locale)
                    : "No successful import"}
                </p>
                {provider.latestAttempt?.errorCode && (
                  <p className="muted">{provider.latestAttempt.errorCode}</p>
                )}
                {provider.scheduledForSelectedSite === false && (
                  <p>Schedules target another site.</p>
                )}
                <p className="integration-note">
                  Configuration and stored sync history; credentials are not
                  checked live here.
                </p>
              </article>
            ))}
          </div>
          <p className="integration-note" role="status">
            Status refreshed {displayDate(status.observedAt, locale)}. Model
            access checks run at startup and every fifteen minutes.
          </p>
        </>
      )}
    </section>
  );
}
