import { createHash, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReadableStreamDefaultReader } from "node:stream/web";

import { isInternalUrl, normalizeUrl, type SiteScope } from "@roco/seo-core";
import { z } from "zod";

export type GoogleProvider = "GSC" | "GA4" | "PAGESPEED";
export type GscDimensionSet = "PAGE" | "QUERY" | "PAGE_QUERY";
export type PageSpeedStrategy = "mobile" | "desktop";

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z
    .literal("https://oauth2.googleapis.com/token")
    .default("https://oauth2.googleapis.com/token"),
});

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function createServiceAccountTokenProvider(input: {
  credentialFile: string;
  scopes: readonly string[];
  fetcher?: typeof fetch;
  now?: () => number;
}): AccessTokenProvider {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  return {
    async getAccessToken() {
      if (cached !== undefined && cached.expiresAt - 60_000 > now())
        return cached.token;
      const credential = serviceAccountSchema.parse(
        JSON.parse(await readFile(input.credentialFile, "utf8")),
      );
      const issuedAt = Math.floor(now() / 1000);
      const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = encode(
        JSON.stringify({
          iss: credential.client_email,
          scope: input.scopes.join(" "),
          aud: credential.token_uri,
          iat: issuedAt,
          exp: issuedAt + 3600,
        }),
      );
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${claims}`);
      const assertion = `${header}.${claims}.${signer.sign(credential.private_key, "base64url")}`;
      let body: { access_token: string; expires_in: number } | undefined;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const response = await fetcher(credential.token_uri, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(30000),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
              assertion,
            }),
          });
          if (!response.ok)
            throw new GoogleApiError(
              "AUTH_FAILED",
              response.status,
              response.status === 429 || response.status >= 500,
            );
          body = z
            .object({
              access_token: z.string(),
              expires_in: z.number().positive(),
            })
            .parse(await boundedJson(response, 65536));
          break;
        } catch (error) {
          const retryable =
            error instanceof GoogleApiError
              ? error.retryable
              : error instanceof TypeError ||
                (error instanceof DOMException &&
                  ["AbortError", "TimeoutError"].includes(error.name));
          if (!retryable || attempt === 2) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * 2 ** attempt),
          );
        }
      }
      if (!body) throw new GoogleApiError("AUTH_FAILED", 0, false);
      cached = {
        token: body.access_token,
        expiresAt: now() + body.expires_in * 1000,
      };
      return cached.token;
    },
  };
}

export class GoogleApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`Google API request failed (${code}, HTTP ${status}).`);
    this.name = "GoogleApiError";
  }
}

export interface GoogleRequestPolicy {
  readonly timeoutMs: number;
  readonly retryLimit: number;
  readonly requestsPerSecond: number;
}

async function boundedJson(
  response: Response,
  maximum = 16 * 1024 * 1024,
): Promise<unknown> {
  if (!response.body)
    throw new GoogleApiError("EMPTY_RESPONSE", response.status, false);
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new GoogleApiError("RESPONSE_LIMIT", response.status, false);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

const requestStarts = new WeakMap<GoogleRequestPolicy, number>();
async function pace(policy: GoogleRequestPolicy): Promise<void> {
  const now = Date.now(),
    next = Math.max(now, requestStarts.get(policy) ?? 0);
  requestStarts.set(policy, next + 1000 / policy.requestsPerSecond);
  if (next > now)
    await new Promise((resolve) => setTimeout(resolve, next - now));
}

async function googleRequest<T>(input: {
  url: string;
  method?: "GET" | "POST";
  tokenProvider?: AccessTokenProvider;
  apiKey?: string;
  body?: unknown;
  schema: z.ZodType<T>;
  policy: GoogleRequestPolicy;
  fetcher?: typeof fetch;
}): Promise<T> {
  const fetcher = input.fetcher ?? fetch;
  const url = new URL(input.url);
  if (input.apiKey !== undefined) url.searchParams.set("key", input.apiKey);
  let lastError: unknown;
  for (let attempt = 0; attempt <= input.policy.retryLimit; attempt += 1) {
    await pace(input.policy);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.policy.timeoutMs,
    );
    try {
      const token = await input.tokenProvider?.getAccessToken();
      const response = await fetcher(url, {
        method: input.method ?? "GET",
        signal: controller.signal,
        redirect: "error",
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(input.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new GoogleApiError(
          response.status === 429 ? "QUOTA_LIMITED" : "HTTP_ERROR",
          response.status,
          retryable,
        );
      }
      return input.schema.parse(await boundedJson(response));
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof GoogleApiError
          ? error.retryable
          : error instanceof TypeError ||
            (error instanceof DOMException &&
              ["AbortError", "TimeoutError"].includes(error.name));
      if (!retryable || attempt === input.policy.retryLimit) throw error;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(1000 / input.policy.requestsPerSecond, 250) * 2 ** attempt,
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export interface UrlMappingResult {
  readonly observedUrl: string;
  readonly normalizedUrl: string | null;
  readonly normalizedUrlHash: string | null;
  readonly normalizationVersion: string | null;
  readonly matchedScope: boolean;
  readonly reason: "MATCHED" | "INVALID_URL" | "OUTSIDE_SITE_SCOPE";
}

export function mapGoogleUrl(
  observedUrl: string,
  scope: SiteScope,
): UrlMappingResult {
  try {
    const absolute = new URL(observedUrl, scope.canonicalOrigin).toString();
    if (!isInternalUrl(absolute, scope)) {
      return {
        observedUrl,
        normalizedUrl: null,
        normalizedUrlHash: null,
        normalizationVersion: null,
        matchedScope: false,
        reason: "OUTSIDE_SITE_SCOPE",
      };
    }
    const normalized = normalizeUrl(absolute);
    return {
      observedUrl,
      normalizedUrl: normalized.normalizedUrl,
      normalizedUrlHash: normalized.normalizedUrlHash,
      normalizationVersion: normalized.version,
      matchedScope: true,
      reason: "MATCHED",
    };
  } catch {
    return {
      observedUrl,
      normalizedUrl: null,
      normalizedUrlHash: null,
      normalizationVersion: null,
      matchedScope: false,
      reason: "INVALID_URL",
    };
  }
}

export function normalizeSearchQuery(value: string): {
  displayQuery: string;
  normalizedQuery: string;
  queryHash: string;
} {
  const normalizedQuery = value
    .trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  return {
    displayQuery: value,
    normalizedQuery,
    queryHash: createHash("sha256").update(normalizedQuery).digest("hex"),
  };
}

const gscResponseSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        position: z.number(),
      }),
    )
    .default([]),
  responseAggregationType: z.string().optional(),
});

export interface GscMetricRow {
  readonly dimensionSet: GscDimensionSet;
  readonly date: string;
  readonly page: string | null;
  readonly query: string | null;
  readonly country: string;
  readonly device: string;
  readonly searchType: string;
  readonly dataState: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export function createGscClient(input: {
  tokenProvider: AccessTokenProvider;
  policy: GoogleRequestPolicy;
  fetcher?: typeof fetch;
}) {
  return {
    async queryAll(request: {
      property: string;
      startDate: string;
      endDate: string;
      dimensionSet: GscDimensionSet;
      rowLimit?: number;
      dataState?: "all" | "final";
    }): Promise<{ rows: GscMetricRow[]; requestCount: number }> {
      const dimensions =
        request.dimensionSet === "PAGE"
          ? ["date", "page", "country", "device"]
          : request.dimensionSet === "QUERY"
            ? ["date", "query", "country", "device"]
            : ["date", "page", "query", "country", "device"];
      const rowLimit = Math.min(request.rowLimit ?? 25_000, 25_000);
      if (!Number.isInteger(rowLimit) || rowLimit < 1)
        throw new GoogleApiError("INVALID_ROW_LIMIT", 0, false);
      const rows: GscMetricRow[] = [];
      let startRow = 0;
      let requestCount = 0;
      let hasMore = true;
      while (hasMore) {
        if (requestCount >= 100 || rows.length >= 100000)
          throw new GoogleApiError("IMPORT_LIMIT", 0, false);
        const response = await googleRequest({
          url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(request.property)}/searchAnalytics/query`,
          method: "POST",
          tokenProvider: input.tokenProvider,
          policy: input.policy,
          ...(input.fetcher === undefined ? {} : { fetcher: input.fetcher }),
          body: {
            startDate: request.startDate,
            endDate: request.endDate,
            dimensions,
            rowLimit,
            startRow,
            type: "web",
            dataState: request.dataState ?? "final",
          },
          schema: gscResponseSchema,
        });
        requestCount += 1;
        if (rows.length + response.rows.length > 100000)
          throw new GoogleApiError("IMPORT_LIMIT", 0, false);
        for (const row of response.rows) {
          const values = Object.fromEntries(
            dimensions.map((name, index) => [name, row.keys[index] ?? ""]),
          );
          rows.push({
            dimensionSet: request.dimensionSet,
            date: values.date ?? "",
            page:
              request.dimensionSet === "QUERY" ? null : (values.page ?? null),
            query:
              request.dimensionSet === "PAGE" ? null : (values.query ?? null),
            country: values.country ?? "",
            device: values.device ?? "",
            searchType: "web",
            dataState: request.dataState ?? "final",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          });
        }
        hasMore = response.rows.length === rowLimit;
        startRow += response.rows.length;
      }
      return { rows, requestCount };
    },
  };
}

const ga4ResponseSchema = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string().default("") })),
        metricValues: z.array(z.object({ value: z.string().default("0") })),
      }),
    )
    .default([]),
  rowCount: z.number().int().nonnegative().optional(),
});

export interface Ga4MetricRow {
  readonly date: string;
  readonly landingPage: string;
  readonly channel: "Organic Search";
  readonly sessions: number;
  readonly totalUsers: number;
  readonly engagedSessions: number;
  readonly engagementRate: number;
  readonly keyEvents: number;
}

export function createGa4Client(input: {
  tokenProvider: AccessTokenProvider;
  policy: GoogleRequestPolicy;
  fetcher?: typeof fetch;
}) {
  return {
    async queryOrganicLandingPages(request: {
      propertyId: string;
      startDate: string;
      endDate: string;
      pageSize?: number;
    }): Promise<{ rows: Ga4MetricRow[]; requestCount: number }> {
      const limit = Math.min(request.pageSize ?? 100_000, 100_000);
      if (!Number.isInteger(limit) || limit < 1)
        throw new GoogleApiError("INVALID_ROW_LIMIT", 0, false);
      const rows: Ga4MetricRow[] = [];
      let offset = 0;
      let requestCount = 0;
      let hasMore = true;
      while (hasMore) {
        if (requestCount >= 100 || rows.length >= 100000)
          throw new GoogleApiError("IMPORT_LIMIT", 0, false);
        const response = await googleRequest({
          url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(request.propertyId)}:runReport`,
          method: "POST",
          tokenProvider: input.tokenProvider,
          policy: input.policy,
          ...(input.fetcher === undefined ? {} : { fetcher: input.fetcher }),
          body: {
            dateRanges: [
              { startDate: request.startDate, endDate: request.endDate },
            ],
            dimensions: [
              { name: "date" },
              { name: "landingPagePlusQueryString" },
            ],
            metrics: [
              "sessions",
              "totalUsers",
              "engagedSessions",
              "engagementRate",
              "keyEvents",
            ].map((name) => ({ name })),
            dimensionFilter: {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: {
                  matchType: "EXACT",
                  value: "Organic Search",
                  caseSensitive: true,
                },
              },
            },
            limit: String(limit),
            offset: String(offset),
            keepEmptyRows: false,
          },
          schema: ga4ResponseSchema,
        });
        requestCount += 1;
        if (rows.length + response.rows.length > 100000)
          throw new GoogleApiError("IMPORT_LIMIT", 0, false);
        for (const row of response.rows) {
          const metric = (index: number) =>
            Number(row.metricValues[index]?.value ?? 0);
          const rawDate = row.dimensionValues[0]?.value ?? "";
          const date = /^\d{8}$/.test(rawDate)
            ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
            : rawDate;
          rows.push({
            date,
            landingPage: row.dimensionValues[1]?.value ?? "",
            channel: "Organic Search",
            sessions: metric(0),
            totalUsers: metric(1),
            engagedSessions: metric(2),
            engagementRate: metric(3),
            keyEvents: metric(4),
          });
        }
        offset += response.rows.length;
        hasMore =
          response.rows.length === limit &&
          offset < (response.rowCount ?? offset);
      }
      return { rows, requestCount };
    },
  };
}

const pagespeedSchema = z.object({
  lighthouseResult: z.object({
    lighthouseVersion: z.string().optional(),
    fetchTime: z.string().datetime().optional(),
    categories: z
      .object({
        performance: z
          .object({ score: z.number().nullable().optional() })
          .optional(),
      })
      .optional(),
    audits: z
      .record(z.string(), z.object({ numericValue: z.number().optional() }))
      .default({}),
  }),
  loadingExperience: z
    .object({
      metrics: z
        .record(
          z.string(),
          z.object({
            percentile: z.number().optional(),
            category: z.string().optional(),
          }),
        )
        .default({}),
    })
    .optional(),
});

export interface PageSpeedSnapshot {
  readonly url: string;
  readonly strategy: PageSpeedStrategy;
  readonly collectedAt: Date;
  readonly performanceScore: number | null;
  readonly lcpMs: number | null;
  readonly inpMs: number | null;
  readonly cls: number | null;
  readonly fieldLcpMs: number | null;
  readonly fieldInpMs: number | null;
  readonly fieldCls: number | null;
  readonly fieldDataAvailable: boolean;
  readonly lighthouseVersion: string | null;
  readonly apiVersion: "v5";
}

export function parsePageSpeedResponse(
  url: string,
  strategy: PageSpeedStrategy,
  payload: unknown,
  now = new Date(),
): PageSpeedSnapshot {
  const response = pagespeedSchema.parse(payload);
  const audit = response.lighthouseResult.audits;
  const field = response.loadingExperience?.metrics ?? {};
  const percentile = (name: string) => field[name]?.percentile ?? null;
  const collectedAt =
    response.lighthouseResult.fetchTime === undefined
      ? now
      : new Date(response.lighthouseResult.fetchTime);
  return {
    url,
    strategy,
    collectedAt,
    performanceScore:
      response.lighthouseResult.categories?.performance?.score ?? null,
    lcpMs: audit["largest-contentful-paint"]?.numericValue ?? null,
    inpMs: audit["interaction-to-next-paint"]?.numericValue ?? null,
    cls: audit["cumulative-layout-shift"]?.numericValue ?? null,
    fieldLcpMs: percentile("LARGEST_CONTENTFUL_PAINT_MS"),
    fieldInpMs: percentile("INTERACTION_TO_NEXT_PAINT"),
    fieldCls: percentile("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fieldDataAvailable: Object.keys(field).length > 0,
    lighthouseVersion: response.lighthouseResult.lighthouseVersion ?? null,
    apiVersion: "v5",
  };
}

export function createPageSpeedClient(input: {
  apiKey?: string;
  policy: GoogleRequestPolicy;
  fetcher?: typeof fetch;
}) {
  return {
    async inspect(
      url: string,
      strategy: PageSpeedStrategy,
    ): Promise<PageSpeedSnapshot> {
      const endpoint = new URL(
        "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
      );
      endpoint.searchParams.set("url", url);
      endpoint.searchParams.set("strategy", strategy);
      endpoint.searchParams.append("category", "performance");
      const payload = await googleRequest({
        url: endpoint.toString(),
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
        policy: input.policy,
        ...(input.fetcher === undefined ? {} : { fetcher: input.fetcher }),
        schema: z.unknown(),
      });
      return parsePageSpeedResponse(url, strategy, payload);
    },
  };
}
