"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  controlListSchema,
  siteListSchema,
  type ControlList,
  type ControlSection,
  type ControlIdentity,
  type ControlRow,
} from "@roco/shared/control";
import {
  record,
  records,
  text,
  label,
  formatMetric,
  displayDate,
  errorMessage,
} from "../lib/presentation";
import { Badge, Evidence } from "./evidence";
import { Integrations } from "./integrations";
import { Detail } from "./detail";
const sections: [ControlSection, string, string][] = [
  ["overview", "Overview", "01"],
  ["issues", "Technical health", "02"],
  ["crawls", "Crawl history", "03"],
  ["performance", "Search performance", "04"],
  ["opportunities", "Opportunities", "05"],
  ["agents", "AI recommendations", "06"],
  ["recommendations", "Review queue", "07"],
  ["changes", "Change Ledger", "08"],
  ["measurements", "Measurements", "09"],
  ["signals", "Alerts / failures", "10"],
  ["freshness", "Data freshness", "11"],
  ["integrations", "Integrations", "12"],
];
const hints: Record<ControlSection, string> = {
  overview: "The evidence behind today’s decisions.",
  issues: "Deterministic findings, with crawl provenance and comparison.",
  crawls: "Immutable observations and the latest crawl attempts.",
  performance: "Stored Google observations. Dimension sets remain separate.",
  opportunities: "Prioritized candidates with explainable scores.",
  agents: "Validated analysis, suggested actions and evidence.",
  recommendations: "Review one exact proposal version at a time.",
  changes: "A record of human work applied outside this system.",
  measurements: "Compare observed outcomes at 30, 60 and 90 days.",
  signals: "Existing operational failures; technical findings live in Health.",
  freshness: "Last attempts, successful observations and failed collections.",
  integrations: "Agent activation, provider access and collection setup.",
};
async function request(path: string, init?: RequestInit) {
  const response = await fetch("/api/control" + path, {
    ...init,
    cache: "no-store",
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(errorMessage(text(record(data).error)));
  return data;
}
export function ControlCenter({
  identity,
  csrf,
}: {
  identity: ControlIdentity;
  csrf: string;
}) {
  const [sites, setSites] = useState<ReturnType<typeof siteListSchema.parse>>(
      [],
    ),
    [siteId, setSiteId] = useState(""),
    [section, setSection] = useState<ControlSection>("overview"),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [offset, setOffset] = useState(0),
    [list, setList] = useState<ControlList | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [detail, setDetail] = useState<Record<string, unknown> | null>(null),
    [detailId, setDetailId] = useState(""),
    [detailLoading, setDetailLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [rtl, setRtl] = useState(false),
    [notice, setNotice] = useState("");
  const detailRequest = useRef<AbortController | null>(null);
  const commandKeys = useRef(new Map<string, string>());
  const dialog = useRef<HTMLDialogElement>(null),
    filterForm = useRef<HTMLFormElement>(null),
    locale = rtl ? "fa-IR" : "en-US",
    operator = identity.roles.includes("OPERATOR");
  useEffect(() => {
    const abort = new AbortController();
    void request("/control/sites", { signal: abort.signal })
      .then((data) => {
        const parsed = siteListSchema.parse(data);
        setSites(parsed);
        setSiteId(
          parsed.find((s) => s.status === "ACTIVE")?.id ?? parsed[0]?.id ?? "",
        );
        setLoading(false);
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Site list unavailable.",
          );
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (section === "integrations") {
      setLoading(false);
      setList(null);
      setError("");
      return;
    }
    if (!siteId) return;
    const abort = new AbortController();
    setLoading(true);
    setList(null);
    setError("");
    const query = new URLSearchParams({
      ...filters,
      limit: "25",
      offset: String(offset),
    });
    void request(`/sites/${siteId}/control/${section}?${query}`, {
      signal: abort.signal,
    })
      .then((data) => {
        setList(controlListSchema.parse(data));
        setLoading(false);
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : "Data unavailable.");
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [siteId, section, filters, offset, refresh]);
  useEffect(() => {
    if (detailId && !dialog.current?.open) dialog.current?.showModal();
  }, [detailId]);
  function closeDetail() {
    detailRequest.current?.abort();
    dialog.current?.close();
    setDetailId("");
    setDetail(null);
  }
  function changeSection(next: ControlSection) {
    closeDetail();
    setSection(next);
    setFilters({});
    setOffset(0);
    setNotice("");
    filterForm.current?.reset();
  }
  async function openDetail(id: string, next: ControlSection = section) {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const result = await request(`/sites/${siteId}/control/${next}/${id}`, {
        signal: abort.signal,
      });
      if (!abort.signal.aborted) setDetail(record(result));
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : "Detail unavailable.");
    } finally {
      if (!abort.signal.aborted) setDetailLoading(false);
    }
  }
  function navigate(next: ControlSection, id?: string) {
    changeSection(next);
    if (next === "agents" && id) setFilters({ opportunityId: id });
    else if (id) void openDetail(id, next);
  }
  async function mutate(suffix: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (
        typeof body === "object" &&
        body !== null &&
        "idempotencyKey" in body
      ) {
        const payload = { ...body, idempotencyKey: undefined },
          fingerprint = siteId + suffix + JSON.stringify(payload);
        const key = commandKeys.current.get(fingerprint) ?? crypto.randomUUID();
        commandKeys.current.set(fingerprint, key);
        body = { ...payload, idempotencyKey: key };
      }
      const result = await request(`/sites/${siteId}/workflow${suffix}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
      setRefresh((r) => r + 1);
      setNotice("Saved. The website has not been changed by this system.");
      if (detailId) await openDetail(detailId);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      throw err;
    } finally {
      setBusy(false);
    }
  }
  function applyFilters(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setFilters(
      Object.fromEntries(
        [...f.entries()].filter(([, v]) => typeof v === "string" && v !== ""),
      ) as Record<string, string>,
    );
    setOffset(0);
  }
  async function signOut() {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (response.ok) window.location.assign("/sign-in");
    else setError("Sign-out failed. Try again.");
  }
  const title = sections.find(([s]) => s === section)?.[1] ?? section,
    currentSite = sites.find((s) => s.id === siteId),
    detailSections = [
      "crawls",
      "issues",
      "opportunities",
      "agents",
      "recommendations",
      "changes",
      "measurements",
    ];
  return (
    <div className="workspace" dir={rtl ? "rtl" : "ltr"} lang="en">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="wordmark" href="/">
          <span className="brand">R</span>
          <span>
            ROCO <small>SEO CONTROL CENTER</small>
          </span>
        </a>
        <p className="nav-caption">Workspace</p>
        <nav aria-label="Control center">
          {sections.map(([s, name, n]) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              onClick={() => changeSection(s)}
            >
              <span className="nav-number" aria-hidden="true">
                {n}
              </span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="live-dot" /> Private / Human controlled
          <p>No production write connection</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <label className="site-selector">
            Site
            <select
              aria-label="Site"
              value={siteId}
              onChange={(e) => {
                closeDetail();
                setSiteId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="" disabled>
                Select site
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="top-actions">
            <button onClick={() => setRtl(!rtl)} aria-pressed={rtl}>
              فارسی / RTL
            </button>
            <span className="actor">
              {identity.displayName}
              <small>{identity.roles.join(" · ")}</small>
            </span>
            <button
              onClick={() => {
                void signOut().catch(() => setError("Sign-out failed."));
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main" className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                Roco intelligence / {currentSite?.name ?? "No site selected"}
              </p>
              <h1>{title}</h1>
              <p>{hints[section]}</p>
            </div>
            <button
              disabled={(section !== "integrations" && !siteId) || loading}
              onClick={() => setRefresh((r) => r + 1)}
            >
              Refresh data
            </button>
          </div>
          {section === "integrations" && (
            <Integrations
              siteId={siteId}
              csrf={csrf}
              operator={operator}
              refresh={refresh}
              locale={locale}
            />
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              <button onClick={() => setRefresh((r) => r + 1)}>Retry</button>{" "}
              <a href="/sign-in">Sign in</a>
            </div>
          )}
          {!loading && !siteId && !error && section !== "integrations" && (
            <div className="empty">
              <h2>No registered sites</h2>
              <p>
                Register an approved site and host scope using the documented
                setup before collecting data.
              </p>
            </div>
          )}
          {section !== "overview" &&
            section !== "freshness" &&
            section !== "integrations" && (
              <form
                key={section}
                ref={filterForm}
                className="filters"
                onSubmit={applyFilters}
              >
                {[
                  "issues",
                  "opportunities",
                  "agents",
                  "recommendations",
                  "changes",
                  "measurements",
                  "signals",
                  "crawls",
                ].includes(section) && (
                  <label>
                    Status
                    <select aria-label="Status" name="status" defaultValue="">
                      <option value="">All statuses</option>
                      {(section === "issues"
                        ? ["OBSERVED", "NOT_OBSERVED"]
                        : section === "opportunities"
                          ? [
                              "OPEN",
                              "ACKNOWLEDGED",
                              "STALE",
                              "DISMISSED",
                              "RESOLVED",
                            ]
                          : section === "recommendations"
                            ? [
                                "DRAFT",
                                "READY_FOR_REVIEW",
                                "APPROVED",
                                "REJECTED",
                                "CHANGES_REQUESTED",
                                "IMPLEMENTED",
                                "CANCELLED",
                              ]
                            : section === "changes" ||
                                section === "measurements"
                              ? ["IMPLEMENTED", "REVERTED"]
                              : [
                                  "QUEUED",
                                  "RUNNING",
                                  "SUCCEEDED",
                                  "FAILED",
                                  "PARTIAL",
                                  "CANCELLED",
                                ]
                      ).map((v) => (
                        <option key={v} value={v}>
                          {label(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["issues", "signals"].includes(section) && (
                  <label>
                    Severity
                    <select aria-label="Severity" name="severity">
                      <option value="">All severities</option>
                      {["CRITICAL", "ERROR", "WARNING", "INFO"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                )}
                {["issues", "opportunities", "recommendations"].includes(
                  section,
                ) && (
                  <label>
                    {section === "recommendations" ? "Risk" : "Type"}
                    <input
                      name="type"
                      placeholder={
                        section === "issues"
                          ? "Rule code"
                          : section === "opportunities"
                            ? "CTR, DECAY…"
                            : "LOW, MEDIUM, HIGH…"
                      }
                    />
                  </label>
                )}
                {[
                  "issues",
                  "opportunities",
                  "recommendations",
                  "performance",
                  "changes",
                  "measurements",
                ].includes(section) && (
                  <label>
                    Page URL
                    <input
                      name="pageUrl"
                      type="url"
                      placeholder="Exact page URL (optional)"
                    />
                  </label>
                )}
                {section === "issues" && (
                  <label>
                    Crawl ID
                    <input
                      name="crawlId"
                      placeholder="Latest successful by default"
                    />
                  </label>
                )}
                {section === "opportunities" && (
                  <>
                    <label>
                      Minimum score
                      <input name="minScore" type="number" min="0" max="100" />
                    </label>
                    <label>
                      Sort
                      <select aria-label="Sort" name="sort">
                        <option value="score">Highest priority</option>
                        <option value="recent">Most recent</option>
                      </select>
                    </label>
                  </>
                )}
                {section === "performance" && (
                  <>
                    <label>
                      Dataset
                      <select aria-label="Dataset" name="dataset">
                        {[
                          "PAGE",
                          "QUERY",
                          "PAGE_QUERY",
                          "GA4",
                          "PAGESPEED",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From
                      <input name="startDate" type="date" />
                    </label>
                    <label>
                      Through
                      <input name="endDate" type="date" />
                    </label>
                    <label>
                      PageSpeed strategy
                      <select aria-label="PageSpeed strategy" name="strategy">
                        <option>mobile</option>
                        <option>desktop</option>
                      </select>
                    </label>
                  </>
                )}
                {section === "agents" && filters.opportunityId && (
                  <input
                    type="hidden"
                    name="opportunityId"
                    value={filters.opportunityId}
                  />
                )}
                <button type="submit">Apply filters</button>
              </form>
            )}
          {loading && (
            <div className="empty" role="status">
              Loading stored observations…
            </div>
          )}
          {list && !loading && (
            <>
              {section === "overview" ? (
                <Overview list={list} locale={locale} navigate={navigate} />
              ) : (
                section === "performance" && (
                  <Performance list={list} locale={locale} />
                )
              )}
              <div className="notes">
                {list.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
              {section !== "overview" && (
                <section className="panel" aria-label={title}>
                  <div className="panel-heading">
                    <h2>{section === "freshness" ? "Source status" : title}</h2>
                    <span className="muted">
                      {list.items.length
                        ? `${offset + 1}–${offset + list.items.length}`
                        : "No observations"}{" "}
                      · {list.hasMore ? "More available" : "End of results"}
                    </span>
                  </div>
                  {list.items.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">
                              {section === "performance"
                                ? "Page / query / sample"
                                : "Finding / record"}
                            </th>
                            <th scope="col">Status / type</th>
                            <th scope="col">
                              {section === "opportunities"
                                ? "Priority"
                                : "Evidence / context"}
                            </th>
                            <th scope="col">Observed / updated</th>
                            <th scope="col">
                              <span className="sr-only">Detail</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.items.map((row) => (
                            <DataRow
                              key={row.id}
                              row={row}
                              section={section}
                              locale={locale}
                              onOpen={() => {
                                void openDetail(row.id);
                              }}
                              hasDetail={detailSections.includes(section)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      <h3>No matching {title.toLowerCase()}</h3>
                      <p>
                        There are no stored observations matching this view.
                        Check collection status and filters.
                      </p>
                      <button onClick={() => navigate("freshness")}>
                        Check data freshness
                      </button>
                    </div>
                  )}
                  <div className="pagination">
                    <button
                      disabled={offset === 0 || loading}
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      Previous
                    </button>
                    <span>Page {Math.floor(offset / 25) + 1}</span>
                    <button
                      disabled={!list.hasMore || loading}
                      onClick={() => setOffset(offset + 25)}
                    >
                      Next
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
        <footer className="footer">
          Stored evidence · Explicit human review · No autonomous website
          changes
        </footer>
      </div>
      <dialog ref={dialog} className="detail-dialog" onCancel={closeDetail}>
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Evidence & workflow</p>
            <h2>Record detail</h2>
          </div>
          <button aria-label="Close detail" onClick={closeDetail}>
            Close ×
          </button>
        </header>
        <div className="drawer-content">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}

          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {detailLoading ? (
            <p role="status">Loading record…</p>
          ) : detail ? (
            <Detail
              key={detailId + section}
              section={section}
              data={detail}
              operator={operator}
              busy={busy}
              mutate={mutate}
              navigate={navigate}
            />
          ) : (
            <p>Record unavailable.</p>
          )}
        </div>
      </dialog>
    </div>
  );
}
function DataRow({
  row,
  section,
  locale,
  onOpen,
  hasDetail,
}: {
  row: ControlRow;
  section: ControlSection;
  locale: string;
  onOpen: () => void;
  hasDetail: boolean;
}) {
  return (
    <tr>
      <td>
        <strong dir="auto">
          {row.label.startsWith("http") ? row.label : label(row.label)}
        </strong>
        {row.url && row.url !== row.label && (
          <small dir="ltr" className="url">
            {row.url}
          </small>
        )}
      </td>
      <td>
        {row.status && <Badge value={row.status} />}{" "}
        {row.severity && <Badge value={row.severity} />}
        <small>{row.kind && label(row.kind)}</small>
      </td>
      <td>
        {section === "opportunities" ? (
          <>
            <strong className="score">
              {formatMetric("score", row.score, locale)}
            </strong>
            <small>{text(row.data.query)}</small>
            <small>Component scores / 100</small>
            <Evidence value={row.data.components} scores />
          </>
        ) : (
          <Evidence value={rowContext(row, section)} />
        )}
      </td>
      <td className="date">
        {row.at ? displayDate(row.at, locale) : "Unavailable"}
      </td>
      <td>
        {hasDetail && (
          <button onClick={onOpen} aria-label={`Open ${row.label}`}>
            Open
          </button>
        )}
      </td>
    </tr>
  );
}
function Overview({
  list,
  locale,
  navigate,
}: {
  list: ControlList;
  locale: string;
  navigate: (s: ControlSection, id?: string) => void;
}) {
  const cards: [string, string, ControlSection][] = [
    ["pages", "Pages crawled", "crawls"],
    ["indexable", "Indexable pages", "issues"],
    ["critical", "Critical findings", "issues"],
    ["opportunities", "Open opportunities", "opportunities"],
    ["reviews", "Awaiting review", "recommendations"],
    ["measuring", "Changes under measurement", "measurements"],
  ];
  const latest = record(list.summary.latestCrawl);
  return (
    <>
      <div className="overview-banner">
        <div>
          <span className="live-dot" />
          <b>Latest crawl attempt</b>
          <Badge value={latest.status ?? "NO_DATA"} />
          <span>{displayDate(latest.finishedAt, locale)}</span>
        </div>
        <button onClick={() => navigate("crawls")}>
          Inspect crawl history{" "}
          <span className="direction-icon" aria-hidden="true">
            →
          </span>
        </button>
      </div>
      <section className="metric-grid" aria-label="Operational overview">
        {cards.map(([key, name, s]) => (
          <button className="metric-card" key={key} onClick={() => navigate(s)}>
            <span>{name}</span>
            <strong>{formatMetric(key, list.summary[key], locale)}</strong>
            <small>
              {["pages", "indexable", "critical"].includes(key)
                ? "Latest successful crawl"
                : "Current stored workflow"}{" "}
              <span className="direction-icon" aria-hidden="true">
                ↗
              </span>
            </small>
          </button>
        ))}
      </section>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Collection status</h2>
            <button onClick={() => navigate("freshness")}>All sources</button>
          </div>
          <div className="freshness-grid">
            {list.items.map((row) => (
              <div className="source-card" key={row.id}>
                <strong>{row.label}</strong>
                <Badge value={row.status} />
                <span>{displayDate(row.data.latestSuccess, locale)}</span>
                <small>{label(text(row.data.freshness))}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel review-guide">
          <p className="eyebrow">Human decision loop</p>
          <h2>Evidence before action</h2>
          <ol>
            <li>Inspect the prioritized opportunity.</li>
            <li>Review grounded agent analysis.</li>
            <li>Approve the exact proposal version.</li>
            <li>Record manual implementation.</li>
            <li>Evaluate 30 / 60 / 90 day observations.</li>
          </ol>
          <button
            className="primary"
            onClick={() => navigate("recommendations")}
          >
            Open review queue
          </button>
          <p className="muted">
            Approval does not execute a production change.
          </p>
        </section>
      </div>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent agent activity</h2>
            <button onClick={() => navigate("agents")}>View activity</button>
          </div>
          <Evidence value={list.summary.recentAgents} />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent collection problems</h2>
            <button onClick={() => navigate("signals")}>
              Inspect failures
            </button>
          </div>
          <Evidence value={list.summary.recentProblems} />
        </section>
      </div>
    </>
  );
}
function Performance({ list, locale }: { list: ControlList; locale: string }) {
  const metrics = record(list.summary.metrics),
    trend = records(list.summary.trend);
  return (
    <>
      <div className="metric-grid performance-metrics">
        {Object.entries(metrics).map(([key, value]) => (
          <div className="metric-card" key={key}>
            <span>{label(key)}</span>
            <strong>{formatMetric(key, value, locale)}</strong>
          </div>
        ))}
      </div>
      {trend.length > 0 && (
        <section className="panel trend">
          <h2>Daily observations · {text(list.summary.dataset)}</h2>
          <div className="trend-bars" aria-label="Daily trend">
            {trend.map((point) => {
              const m = record(point.metrics),
                key = "clicks" in m ? "clicks" : "sessions",
                value = m[key],
                max = Math.max(
                  1,
                  ...trend.map((t) => Number(record(t.metrics)[key] ?? 0)),
                );
              return (
                <div
                  className="trend-day"
                  key={text(point.date)}
                  title={`${text(point.date)} · ${formatMetric(key, value, locale)} ${key}`}
                >
                  <span>{formatMetric(key, value, locale)}</span>
                  <div
                    style={{
                      height: `${typeof value === "number" ? Math.max(2, (value / max) * 80) : 2}px`,
                    }}
                  />
                  <small>{text(point.date).slice(5)}</small>
                </div>
              );
            })}
          </div>
          <details>
            <summary>Accessible daily values</summary>
            <Evidence value={trend} />
          </details>
        </section>
      )}
    </>
  );
}

function rowContext(row: ControlRow, section: ControlSection) {
  const keys =
    section === "recommendations"
      ? ["risk", "mode", "version", "topic"]
      : section === "agents"
        ? ["provider", "model", "errorCode", "bookedNanousd"]
        : section === "crawls"
          ? ["finishedAt", "errorCode", "summary"]
          : section === "changes" || section === "measurements"
            ? ["mode", "risk", "topic", "metric"]
            : null;
  return keys
    ? Object.fromEntries(keys.map((key) => [key, row.data[key]]))
    : row.data;
}
