import { label, text, record, formatMetric } from "../lib/presentation";
export function Evidence({
  value,
  depth = 0,
  scores = false,
}: {
  value: unknown;
  depth?: number;
  scores?: boolean;
}) {
  if (value === null || value === undefined)
    return <span className="muted">Unavailable</span>;
  if (typeof value !== "object")
    return (
      <span dir="auto" className="value">
        {text(value)}
      </span>
    );
  if (depth >= 6) return <span>{text(value)}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="evidence-list">
        {value.map((v: unknown, i: number) => (
          <li key={i}>
            <Evidence value={v} depth={depth + 1} scores={scores} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="muted">None recorded</span>
    );
  return (
    <dl className="evidence">
      {Object.entries(record(value)).map(([key, v]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>
            {typeof v === "number" ? (
              formatMetric(scores ? "score" : key, v)
            ) : (
              <Evidence
                value={v}
                depth={depth + 1}
                scores={scores || key === "components"}
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Badge({ value }: { value: unknown }) {
  const status = text(value);
  return (
    <span
      className={`badge ${/FAILED|CRITICAL|HIGH|NEGATIVE|REJECTED/.test(status) ? "danger" : /APPROVED|SUCCEEDED|POSITIVE|WITHIN/.test(status) ? "good" : /STALE|PARTIAL|REVIEW|INSUFFICIENT|OLDER/.test(status) ? "warn" : ""}`}
    >
      {label(status)}
    </span>
  );
}
