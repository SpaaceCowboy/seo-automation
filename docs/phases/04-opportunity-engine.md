# Phase 4 - Opportunity Engine

## Objective

Convert historical crawl and Google observations into reproducible, explainable, prioritized SEO opportunities without using LLMs for deterministic detection.

## In scope

- Detection for quick wins, CTR opportunities, content-gap candidates, cannibalization candidates, decay, and internal-link opportunities
- Configurable evidence windows, minimum sample sizes, thresholds, exclusions, and page/business-value inputs
- Versioned scoring with Search Demand, Impact, Confidence, Effort, and Business Value components
- Opportunity lifecycle, deduplication, evidence references, suppression, expiration, and recalculation
- Backtesting against historical windows and analyst-readable explanations

## Out of scope

- Semantic final judgment on intent/content fit
- Recommendation copy or proposed website edits
- Approval workflow and production changes

## Acceptance criteria

- Each detector has a written formula/algorithm, version, required inputs, limitations, and deterministic fixture tests.
- The same source data and configuration produce the same opportunities and scores.
- Every opportunity references its evidence rows/window and exposes component scores, weights, thresholds, and total.
- Scoring configurations are immutable once published; rescoring creates a new result/version.
- Minimum-evidence gates produce `insufficient data` rather than inflated confidence.
- Cannibalization and content-gap outputs are explicitly candidates pending semantic review.
- Decay compares equivalent periods and accounts for incomplete recent GSC data.
- Internal-link candidates exclude unsafe/irrelevant URL classes and contain source/target graph evidence.
- Duplicate runs do not create duplicate active opportunities; changes in evidence are historically traceable.
- Backtesting and sensitivity analysis show how weights/thresholds affect ranking on a representative dataset.
- A human reviewer can understand why a top opportunity outranks another without reading code.
- Tests, typecheck, lint, and build pass; scoring and calibration documentation is updated.

## Human inputs required

- Business value by page type/topic, minimum impressions/clicks, target position bands, comparison windows, excluded query/page classes, and initial component weights

## Exit artifact

An opportunity calibration report with sample ranked results, false-positive review, chosen scoring version, and an explicit stop before Phase 5.
