import {
  record,
  records,
  text,
  label,
  formatMetric,
  displayDate,
} from "../lib/presentation";
import { Badge, Evidence } from "./evidence";
export function MeasurementView({ data }: { data: Record<string, unknown> }) {
  const history = record(data.history),
    results = records(history.results),
    baselines = records(data.baselines),
    latest = baselines[0],
    plans = records(data.plans);
  return (
    <>
      <section className="panel">
        <h4>Frozen baseline · version {text(latest?.number)}</h4>
        <p className="muted">
          {text(record(latest?.sample).startDate)} →{" "}
          {text(record(latest?.sample).endDate)}
        </p>
        <Evidence
          value={{
            capturedAt: record(latest?.sample).capturedAt,
            ...Object.fromEntries(
              ["gsc", "ga4", "psi", "crawl"].map((source) => {
                const group = record(record(latest?.sample)[source]);
                return [
                  source,
                  {
                    values: group.values,
                    observedDays: group.days,
                    samples: group.samples,
                    coverage: group.coverage,
                  },
                ];
              }),
            ),
          }}
        />
      </section>
      <div className="horizon-grid">
        {[30, 60, 90].map((horizon) => {
          const match = results.find(
              (item) => record(item.plan).horizon === horizon,
            ),
            result = record(match?.result),
            outcome = record(result.outcome),
            plan = plans.find((p) => p.horizon === horizon);
          return (
            <section className="panel" key={horizon}>
              <h4>T+{horizon}</h4>
              <Badge value={result.state ?? "WAITING_FOR_MEASUREMENT"} />
              <p className="muted">Ready after {displayDate(plan?.readyAt)}</p>
              {match && (
                <>
                  <p>{label(text(outcome.primary))}</p>
                  <div className="measurement-pair">
                    <span>
                      Before
                      <strong>
                        {formatMetric(text(outcome.primary), outcome.before)}
                      </strong>
                    </span>
                    <span>
                      After
                      <strong>
                        {formatMetric(text(outcome.primary), outcome.after)}
                      </strong>
                    </span>
                  </div>
                  <Evidence
                    value={{
                      absoluteChange: outcome.absoluteChange,
                      relativeChange: outcome.relativeChange,
                      reasons: outcome.reasons,
                      warnings: outcome.warnings,
                    }}
                  />
                </>
              )}
            </section>
          );
        })}
      </div>
      <details>
        <summary>
          Historical baselines, plans and measured evidence (latest 100; source
          IDs capped at 100 per sample)
        </summary>
        <Evidence value={{ baselines, plans, results }} />
      </details>
    </>
  );
}
