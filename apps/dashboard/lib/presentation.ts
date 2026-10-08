import { z } from "zod";
export function record(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
}
export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export function text(value: unknown): string {
  return value === null || value === undefined
    ? "Unavailable"
    : typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
}
export function label(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
}
export function formatMetric(key: string, value: unknown, locale = "en-US") {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value !== "number") return text(value);
  if (/ctr|rate|confidence/i.test(key))
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    value,
  );
}
export function displayDate(value: unknown, locale = "en-US") {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return text(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function errorMessage(code: string) {
  const map: Record<string, string> = {
    SIGN_IN_REQUIRED: "Your session expired. Sign in again.",
    UNAUTHORIZED: "Your access credential was revoked. Sign in again.",
    WORKFLOW_FORBIDDEN: "Your role does not allow this action.",
    STALE_RECOMMENDATION_VERSION:
      "This proposal changed. Refresh and review the current version.",
    INVALID_RECOMMENDATION_TRANSITION:
      "This action is no longer available. Refresh the recommendation.",
    IMPLEMENTATION_DIFFERS_FROM_APPROVAL:
      "Recorded values differ from the approved version. Revise and obtain fresh approval.",
    MEASUREMENT_NOT_READY:
      "The measurement window has not matured. Wait until the ready date shown for this horizon.",
    API_UNAVAILABLE: "The private API is unavailable. Try again.",
    INVALID_CONTROL_REQUEST:
      "Check the filters and date range (maximum 93 days).",
    INVALID_WORKFLOW_REQUEST:
      "Check all required fields and structured values.",
  };
  return (
    map[code] ??
    `Request could not be completed (${code}). Refresh and check your inputs.`
  );
}
