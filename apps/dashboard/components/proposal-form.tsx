"use client";
import { useState, type FormEvent } from "react";
import {
  proposalSchema,
  valuesSchema,
  type Proposal,
  type ChangeValues,
} from "@roco/workflow/contracts";
import { record, text, label } from "../lib/presentation";
const valueFields: Record<string, string> = {
  TITLE: "title",
  META_DESCRIPTION: "metaDescription",
  HEADINGS: "headings",
  CONTENT_BRIEF: "contentReference",
  FAQ: "contentReference",
  MAJOR_REWRITE: "contentReference",
  SCHEMA: "structuredDataReference",
  INTERNAL_LINK: "internalLinks",
  CANONICAL: "canonicalUrl",
  REDIRECT: "redirectTarget",
  URL_CHANGE: "url",
  DELETE: "deleted",
  OBSERVE: "note",
};
function valueInput(values: unknown, key: string) {
  const v = record(values)[key];
  return v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}
export function ProposalForm({
  initial,
  source,
  onSave,
  busy,
}: {
  initial: Record<string, unknown>;
  source?: { outputId: string; actionIndex: number } | undefined;
  onSave: (proposal: Proposal, mode: string) => Promise<void>;
  busy: boolean;
}) {
  const type = text(initial.changeType),
    key = valueFields[type] ?? "note",
    complex = ["headings", "internalLinks", "deleted"].includes(key);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      const fieldText = (field: string) => {
        const v = f.get(field);
        return typeof v === "string" ? v : "";
      };
      const value = (field: string): ChangeValues => {
        const raw = fieldText(field);
        const parsed: unknown = complex
          ? JSON.parse(raw)
          : raw === "null"
            ? null
            : raw;
        return valuesSchema.parse({ [key]: parsed });
      };
      const proposal = proposalSchema.parse({
        ...initial,
        pageType: f.get("pageType"),
        topic: fieldText("topic") || null,
        reason: f.get("reason"),
        before: value("before"),
        after: value("after"),
      });
      await onSave(proposal, fieldText("mode") || "SANDBOX");
      setError("");
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "Check structured entries: use a valid array or boolean."
          : "Check proposal fields. Before and after must describe one concrete change.",
      );
    }
  }
  return (
    <form
      className="action-form"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <h3>{source ? "Create review proposal" : "Revise proposal"}</h3>
      <p className="muted">
        {label(type)} · Target page <bdi>{text(initial.pageId)}</bdi>. Verify
        observed values before submitting.
      </p>
      {source && (
        <label>
          Record context
          <select
            disabled={busy}
            aria-label="Record context"
            name="mode"
            defaultValue="SANDBOX"
          >
            <option value="SANDBOX">Sandbox</option>
            <option value="PRODUCTION">
              Production record — manual work only
            </option>
          </select>
        </label>
      )}
      <div className="comparison">
        <label>
          Before · {label(key)}
          <textarea
            disabled={busy}
            aria-label={`Before · ${label(key)}`}
            name="before"
            required
            defaultValue={valueInput(initial.before, key)}
            maxLength={8000}
          />
        </label>
        <label>
          Proposed after · {label(key)}
          <textarea
            disabled={busy}
            aria-label={`Proposed after · ${label(key)}`}
            name="after"
            required
            defaultValue={valueInput(initial.after, key)}
            maxLength={8000}
          />
        </label>
      </div>
      {complex && (
        <small>
          Structured entries: headings use level and text; links use
          sourcePageId, targetPageId and anchorConcept; deletion uses true or
          false.
        </small>
      )}
      <label>
        Page type
        <input
          disabled={busy}
          name="pageType"
          required
          maxLength={100}
          defaultValue={
            text(initial.pageType) === "Unavailable"
              ? "article"
              : text(initial.pageType)
          }
        />
      </label>
      <label>
        Target topic / query
        <input
          disabled={busy}
          name="topic"
          maxLength={300}
          defaultValue={initial.topic ? text(initial.topic) : ""}
        />
      </label>
      <label>
        Rationale
        <textarea
          disabled={busy}
          aria-label="Rationale"
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={initial.reason ? text(initial.reason) : ""}
        />
      </label>
      <details>
        <summary>Measurement rule supplied by the backend</summary>
        <pre>{JSON.stringify(initial.rule, null, 2)}</pre>
      </details>
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save draft for review"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
export function actionProposal(action: Record<string, unknown>, rule: unknown) {
  const key = valueFields[text(action.type)] ?? "note";
  const empty: unknown =
    key === "deleted"
      ? false
      : ["headings", "internalLinks"].includes(key)
        ? []
        : [
              "title",
              "metaDescription",
              "canonicalUrl",
              "redirectTarget",
            ].includes(key)
          ? null
          : "";
  return {
    pageId: action.targetPageId,
    changeType: action.type,
    pageType: "article",
    topic: null,
    before: { [key]: empty },
    after: {
      [key]: typeof action.proposal === "string" ? action.proposal : empty,
    },
    reason: action.rationale,
    rule,
  };
}
