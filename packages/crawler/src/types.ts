import type {
  PageGraphMetric,
  SiteScope,
  TechnicalIssue,
} from "@roco/seo-core";

export interface CrawlPolicy {
  readonly startUrl: string;
  readonly scope: SiteScope;
  readonly userAgent: string;
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly concurrency: number;
  readonly requestsPerSecond: number;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly retryLimit: number;
  readonly respectRobots: boolean;
  readonly allowPrivateNetworks: boolean;
  readonly ignoredQueryParameters: readonly string[];
}

export interface RedirectHopResult {
  readonly hopIndex: number;
  readonly sourceUrl: string;
  readonly destinationUrl: string;
  readonly httpStatus: number;
  readonly responseMs: number;
}

export interface FetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly status: number | null;
  readonly fetchStatus:
    | "SUCCESS"
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "TOO_LARGE"
    | "REDIRECT_LOOP"
    | "REDIRECT_LIMIT"
    | "BLOCKED"
    | "NETWORK_ERROR";
  readonly headers: Record<string, string>;
  readonly body: string | null;
  readonly responseMs: number;
  readonly redirectHops: readonly RedirectHopResult[];
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface ExtractedLink {
  readonly observedUrl: string;
  readonly normalizedUrl: string;
  readonly anchorText: string | null;
  readonly rel: string | null;
  readonly isInternal: boolean;
}

export interface ExtractedImage {
  readonly sourceUrl: string | null;
  readonly altText: string | null;
  readonly hasAltAttribute: boolean;
}

export interface ExtractedPage {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonicalUrl: string | null;
  readonly metaRobots: readonly string[];
  readonly headings: readonly {
    readonly level: 1 | 2;
    readonly position: number;
    readonly text: string;
  }[];
  readonly schemaTypes: readonly string[];
  readonly hasBreadcrumbs: boolean;
  readonly images: readonly ExtractedImage[];
  readonly links: readonly ExtractedLink[];
  readonly wordCount: number;
  readonly contentHash: string;
  readonly htmlHash: string;
}

export interface CrawledPage {
  readonly observedUrl: string;
  readonly normalizedUrl: string;
  readonly normalizedUrlHash: string;
  readonly normalizationVersion: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly fetchStatus: FetchResult["fetchStatus"];
  readonly contentType: string | null;
  readonly responseMs: number;
  readonly redirectHops: readonly RedirectHopResult[];
  readonly canonicalUrl: string | null;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly robotsAllowed: boolean;
  readonly isIndexable: boolean;
  readonly indexabilityReason: string;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly headings: ExtractedPage["headings"];
  readonly schemaTypes: readonly string[];
  readonly hasBreadcrumbs: boolean;
  readonly images: readonly ExtractedImage[];
  readonly links: readonly ExtractedLink[];
  readonly wordCount: number;
  readonly contentHash: string | null;
  readonly htmlHash: string | null;
  readonly depth: number;
  readonly inSitemap: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface RobotsObservation {
  readonly url: string;
  readonly status: number | null;
  readonly contentHash: string | null;
  readonly fetchedAt: Date;
  readonly sitemaps: readonly string[];
  readonly crawlDelaySeconds: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface SitemapObservation {
  readonly url: string;
  readonly parentUrl: string | null;
  readonly status: number | null;
  readonly contentHash: string | null;
  readonly documentType: "URLSET" | "INDEX" | "INVALID";
  readonly entries: readonly {
    readonly url: string;
    readonly lastModified: string | null;
  }[];
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface CrawlSummary {
  readonly urlsDiscovered: number;
  readonly urlsCrawled: number;
  readonly successfulPages: number;
  readonly indexablePages: number;
  readonly redirects: number;
  readonly http4xx: number;
  readonly http5xx: number;
  readonly noindex: number;
  readonly canonicalIssues: number;
  readonly missingTitles: number;
  readonly duplicateTitles: number;
  readonly missingDescriptions: number;
  readonly orphanPages: number;
  readonly maximumCrawlDepth: number;
  readonly brokenInternalLinks: number;
  readonly issueCount: number;
  readonly durationMs: number;
}

export interface CrawlOutput {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly pages: readonly CrawledPage[];
  readonly robots: RobotsObservation;
  readonly sitemaps: readonly SitemapObservation[];
  readonly issues: readonly TechnicalIssue[];
  readonly pageMetrics: readonly PageGraphMetric[];
  readonly summary: CrawlSummary;
}

export interface CrawlDependencies {
  readonly fetch?: typeof fetch;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly isCancelled?: () => Promise<boolean>;
}
