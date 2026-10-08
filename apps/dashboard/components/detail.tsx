"use client";
import { MeasurementView } from "./measurement";
import { useState, type FormEvent } from "react";
import type { ControlSection } from "@roco/shared/control";
import type { Proposal } from "@roco/workflow/contracts";
import { Evidence, Badge } from "./evidence";
import { ProposalForm, actionProposal } from "./proposal-form";
import {
  record,
  records,
  text,
  label,
  displayDate,
  formatMetric,
} from "../lib/presentation";
export function Detail({
  section,
  data,
  operator,
  busy,
  mutate,
  navigate,
}: {
  section: ControlSection;
  data: Record<string, unknown>;
  operator: boolean;
  busy: boolean;
  mutate: (suffix: string, body: unknown) => Promise<unknown>;
  navigate: (section: ControlSection, id?: string) => void;
}) {
  const [proposal, setProposal] = useState<{
      initial: Record<string, unknown>;
      outputId?: string;
      actionIndex?: number;
    } | null>(null),
    [revision, setRevision] = useState(false);
  if (section === "recommendations") {
    const versions = records(data.versions),
      version = versions.find((v) => v.id === data.currentVersionId) ?? {},
      current = record(version.proposal),
      capabilities = record(data.capabilities),
      actions = Array.isArray(capabilities.actions)
        ? (capabilities.actions as string[])
        : [];
    async function decision(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const f = new FormData(e.currentTarget),
        submitter = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement;
      await mutate(`/recommendations/${text(data.id)}/decisions`, {
        expectedVersionId: data.currentVersionId,
        expectedState: data.state,
        action: submitter.value,
        reason: f.get("reason"),
      });
    }
    async function implement(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const result = record(
        await mutate(`/recommendations/${text(data.id)}/implementation`, {
          versionId: version.id,
          implementedAt: new Date(text(f.get("implementedAt"))).toISOString(),
          actualBefore: current.before,
          actualAfter: current.after,
          notes: f.get("notes"),
          externalReference: f.get("reference"),
          confirmedApplied: f.get("confirmed") === "on",
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      if (result.id) navigate("changes", text(result.id));
    }
    return (
      <>
        <div className="detail-meta">
          <Badge value={data.state} />
          <Badge value={version.risk} />
          <Badge value={data.mode} />
          <span>
            Version {text(version.number)} · Confidence{" "}
            {formatMetric("confidence", version.confidence)}
          </span>
        </div>
        <p className="url" dir="ltr">
          {text(record(data.page).url)}
        </p>
        <p className="notice">
          Approval records a decision. It does not change the website.
        </p>
        <Evidence
          value={{
            provider: record(data.source).provider,
            model: record(data.source).model,
            generatedAt: record(data.source).createdAt,
          }}
        />
        <h3>Exact proposal</h3>
        <div className="comparison">
          <section>
            <h4>Before</h4>
            <Evidence value={current.before} />
          </section>
          <section>
            <h4>Proposed after</h4>
            <Evidence value={current.after} />
          </section>
        </div>
        <p>{text(current.reason)}</p>
        <Evidence
          value={{
            topic: current.topic,
            pageType: current.pageType,
            measurementRule: current.rule,
            proposer: version.createdBy,
            proposedAt: version.createdAt,
          }}
        />
        <details open>
          <summary>Agent evidence and recommendation</summary>
          <Evidence value={record(data.source).analysis} />
        </details>
        {actions.length > 0 && (
          <form
            className="action-form"
            onSubmit={(e) => {
              void decision(e).catch(() => undefined);
            }}
          >
            <label>
              Review reason
              <textarea
                disabled={busy}
                name="reason"
                required
                minLength={3}
                maxLength={1000}
              />
            </label>
            <div className="actions">
              {actions.map((a) => (
                <button
                  key={a}
                  value={a}
                  type="submit"
                  className={a === "APPROVE" ? "primary" : ""}
                  disabled={busy}
                >
                  {label(a)}
                </button>
              ))}
            </div>
          </form>
        )}
        {Boolean(capabilities.canRevise) && (
          <button onClick={() => setRevision(!revision)}>
            Revise exact proposal
          </button>
        )}
        {revision && (
          <ProposalForm
            initial={current}
            busy={busy}
            onSave={async (p: Proposal) => {
              await mutate(`/recommendations/${text(data.id)}/versions`, {
                expectedVersionId: version.id,
                proposal: p,
              });
              setRevision(false);
            }}
          />
        )}
        {Boolean(capabilities.canImplement) && (
          <form
            className="action-form"
            onSubmit={(e) => {
              void implement(e).catch(() => undefined);
            }}
          >
            <h3>Record manual implementation</h3>
            <p>
              Record work already applied elsewhere. The exact approved values
              shown above will be recorded.
            </p>
            <label>
              Applied at (your local time)
              <input
                disabled={busy}
                type="datetime-local"
                step="0.001"
                name="implementedAt"
                required
              />
            </label>
            <label>
              External reference
              <input
                disabled={busy}
                name="reference"
                required
                maxLength={500}
                placeholder="Ticket or change reference"
              />
            </label>
            <label>
              Implementation notes
              <textarea
                disabled={busy}
                name="notes"
                required
                minLength={3}
                maxLength={1000}
              />
            </label>
            <label className="checkbox">
              <input
                disabled={busy}
                type="checkbox"
                name="confirmed"
                required
              />{" "}
              I confirm a human applied these exact values in the stated
              context.
            </label>
            <button className="primary" disabled={busy}>
              Record manual implementation
            </button>
          </form>
        )}
        <details>
          <summary>Versions and decision timeline (latest 100)</summary>
          <Evidence
            value={{ versions, decisions: data.decisions, events: data.events }}
          />
        </details>
      </>
    );
  }
  if (section === "agents")
    return (
      <>
        <Badge value={data.status} />
        <h3>Validated agent outputs</h3>
        {records(data.outputs).map((output) => {
          const analysis = record(output.analysis),
            actions = records(analysis.actions),
            rule = records(data.ruleHints).find(
              (r) => r.outputId === output.id,
            )?.rule;
          return (
            <section className="agent-output" key={text(output.id)}>
              <h4>
                {text(analysis.agent)} · {text(analysis.expectedMetric)}
              </h4>
              <p>{text(analysis.summary)}</p>
              <div className="detail-meta">
                <Badge value={analysis.risk} />
                <span>
                  Confidence {formatMetric("confidence", analysis.confidence)}
                </span>
              </div>
              <Evidence
                value={{
                  observations: analysis.observations,
                  inferences: analysis.inferences,
                  warnings: analysis.warnings,
                  assumptions: analysis.assumptions,
                }}
              />
              {actions.map((a, i) => (
                <section className="action-item" key={i}>
                  <h4>{label(text(a.type))}</h4>
                  <p>{text(a.rationale)}</p>
                  <p dir="auto">{text(a.proposal)}</p>
                  <Evidence
                    value={{
                      targetPageId: a.targetPageId,
                      evidenceIds: a.evidenceIds,
                    }}
                  />
                  {output.draft && operator && a.targetPageId ? (
                    <button
                      onClick={() =>
                        setProposal({
                          initial: actionProposal(a, rule),
                          outputId: text(output.id),
                          actionIndex: i,
                        })
                      }
                    >
                      Create review proposal
                    </button>
                  ) : null}
                </section>
              ))}
            </section>
          );
        })}
        {proposal && (
          <ProposalForm
            key={proposal.outputId + String(proposal.actionIndex)}
            initial={proposal.initial}
            source={{
              outputId: proposal.outputId!,
              actionIndex: proposal.actionIndex!,
            }}
            busy={busy}
            onSave={async (p, mode) => {
              const created = record(
                await mutate("/recommendations", {
                  agentOutputId: proposal.outputId,
                  actionIndex: proposal.actionIndex,
                  mode,
                  proposal: p,
                  idempotencyKey: crypto.randomUUID(),
                }),
              );
              navigate("recommendations", text(created.id));
            }}
          />
        )}
        <details>
          <summary>Source evidence and model provenance</summary>
          <Evidence
            value={{
              evidence: data.evidence,
              invocations: data.invocations,
              bookedNanousd: data.bookedNanousd,
              startedAt: data.startedAt,
              finishedAt: data.finishedAt,
              errorCode: data.errorCode,
            }}
          />
        </details>
      </>
    );
  if (section === "opportunities")
    return (
      <>
        <div className="detail-meta">
          <Badge value={data.type} />
          <Badge value={data.status} />
          <span>Priority {text(data.score)} / 100</span>
        </div>
        <p className="url" dir="ltr">
          {text(data.url)}
        </p>
        <h3>Scoring components and evidence</h3>
        <Evidence
          value={record(
            (
              records(data.observations).find(
                (o) => o.runId === data.lastRunId,
              ) ?? records(data.observations)[0]
            )?.observation,
          )}
        />
        <button onClick={() => navigate("agents", text(data.id))}>
          View related agent recommendations
        </button>
        <details>
          <summary>Observation and lifecycle history (latest 100)</summary>
          <Evidence
            value={{
              observations: data.observations,
              events: data.events,
              decisions: data.decisions,
            }}
          />
        </details>
      </>
    );
  if (section === "changes" || section === "measurements") {
    const version = record(data.version);
    return (
      <>
        <div className="detail-meta">
          <Badge value={data.mode} />
          <Badge value={version.risk} />
          <Badge value={data.recordState} />
          <span>Implemented {displayDate(data.implementedAt)}</span>
        </div>
        <p className="notice">
          Recorded human implementation. Results are associations, not proof of
          causation.
        </p>
        <div className="comparison">
          <section>
            <h4>Recorded before</h4>
            <Evidence value={data.beforeValues} />
          </section>
          <section>
            <h4>Recorded after</h4>
            <Evidence value={data.afterValues} />
          </section>
        </div>
        <p className="url" dir="ltr">
          {text(record(data.page).url)}
        </p>
        <h3>Attribution and timeline</h3>
        <Evidence
          value={{
            proposer: version.createdBy,
            proposedAt: version.createdAt,
            approval: data.approval,
            implementedBy: data.implementedBy,
            implementedAt: data.implementedAt,
            actors: data.actors,
            reason: record(version.proposal).reason,
            topic: record(version.proposal).topic,
            notes: data.notes,
            reference: data.externalReference,
            events: data.events,
          }}
        />
        <h3>Baseline and 30 / 60 / 90 days</h3>
        <p>
          Expected metric:{" "}
          <strong>{text(record(record(version.proposal).rule).primary)}</strong>
        </p>
        <MeasurementView data={data} />
        {operator && (
          <div className="actions">
            {[30, 60, 90].map((h) => (
              <button
                key={h}
                disabled={busy}
                onClick={() => {
                  void mutate(`/changes/${text(data.id)}/measurements/${h}`, {
                    idempotencyKey: crypto.randomUUID(),
                  }).catch(() => undefined);
                }}
              >
                Request T+{h} measurement
              </button>
            ))}
          </div>
        )}
        <small>
          The backend requires a mature window and data lag. An early request
          fails without measuring.
        </small>
        <button
          onClick={() =>
            navigate("recommendations", text(data.recommendationId))
          }
        >
          Open approved recommendation
        </button>
      </>
    );
  }
  return <Evidence value={data} />;
}
