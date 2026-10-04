import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const URL_NORMALIZATION_VERSION = "url-v1";
export const TECHNICAL_RULESET_VERSION = "technical-v1";

export interface UrlNormalizationPolicy {
  readonly ignoredQueryParameters?: readonly string[];
}

export interface NormalizedUrl {
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly normalizedUrlHash: string;
  readonly version: typeof URL_NORMALIZATION_VERSION;
}

export function normalizeUrl(
  input: string,
  base?: string,
  policy: UrlNormalizationPolicy = {},
): NormalizedUrl {
  const url = new URL(input, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  const ignored = new Set(
    (policy.ignoredQueryParameters ?? []).map((value) => value.toLowerCase()),
  );
  const entries = [...url.searchParams.entries()]
    .filter(([key]) => !ignored.has(key.toLowerCase()))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    );
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);

  const normalizedUrl = url.toString();
  return {
    originalUrl: input,
    normalizedUrl,
    normalizedUrlHash: createHash("sha256").update(normalizedUrl).digest("hex"),
    version: URL_NORMALIZATION_VERSION,
  };
}

export interface SiteScope {
  readonly canonicalOrigin: string;
  readonly allowedHosts: readonly {
    readonly host: string;
    readonly includeSubdomains: boolean;
  }[];
}

export function isInternalUrl(input: string, scope: SiteScope): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return scope.allowedHosts.some(({ host, includeSubdomains }) => {
    const allowed = host.toLowerCase();
    return (
      hostname === allowed ||
      (includeSubdomains && hostname.endsWith(`.${allowed}`))
    );
  });
}

export function isPrivateIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb") ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

export interface IndexabilityInput {
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly metaRobots: readonly string[];
  readonly xRobotsTag: readonly string[];
  readonly robotsAllowed: boolean;
  readonly normalizedUrl: string;
  readonly canonicalUrl: string | null;
}

export interface IndexabilityResult {
  readonly isIndexable: boolean;
  readonly reason: string;
}

export function evaluateIndexability(
  input: IndexabilityInput,
): IndexabilityResult {
  if (input.httpStatus === null)
    return { isIndexable: false, reason: "FETCH_FAILED" };
  if (input.httpStatus < 200 || input.httpStatus >= 300)
    return { isIndexable: false, reason: `HTTP_${input.httpStatus}` };
  if (!input.robotsAllowed)
    return { isIndexable: false, reason: "ROBOTS_DISALLOWED" };
  if (!(input.contentType ?? "").toLowerCase().includes("text/html"))
    return { isIndexable: false, reason: "NON_HTML" };
  const directives = [...input.metaRobots, ...input.xRobotsTag].map((value) =>
    value.toLowerCase(),
  );
  if (directives.includes("noindex"))
    return { isIndexable: false, reason: "NOINDEX" };
  if (
    input.canonicalUrl !== null &&
    normalizeUrl(input.canonicalUrl).normalizedUrl !== input.normalizedUrl
  ) {
    return { isIndexable: false, reason: "CANONICAL_TO_OTHER_URL" };
  }
  return { isIndexable: true, reason: "INDEXABLE" };
}

export type IssueSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface TechnicalIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly ruleVersion: typeof TECHNICAL_RULESET_VERSION;
  readonly pageUrl: string | null;
  readonly evidence: Record<string, unknown>;
  readonly remediation: string;
  readonly fingerprint: string;
}

export interface AnalyzedPage {
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly fetchStatus: string;
  readonly isIndexable: boolean;
  readonly indexabilityReason: string;
  readonly canonicalUrl: string | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly headings: readonly {
    readonly level: 1 | 2;
    readonly text: string;
  }[];
  readonly imageCount: number;
  readonly missingAltCount: number;
  readonly wordCount: number;
  readonly redirectCount: number;
  readonly redirectLoop: boolean;
  readonly depth: number;
  readonly inSitemap: boolean;
  readonly internalTargets: readonly string[];
}

function issue(
  code: string,
  severity: IssueSeverity,
  pageUrl: string | null,
  evidence: Record<string, unknown>,
  remediation: string,
): TechnicalIssue {
  const fingerprintSource = JSON.stringify({ code, pageUrl });
  return {
    code,
    severity,
    ruleVersion: TECHNICAL_RULESET_VERSION,
    pageUrl,
    evidence,
    remediation,
    fingerprint: createHash("sha256").update(fingerprintSource).digest("hex"),
  };
}

export interface PageGraphMetric {
  readonly pageUrl: string;
  readonly crawlDepth: number;
  readonly incomingInternalLinks: number;
  readonly outgoingInternalLinks: number;
  readonly isOrphan: boolean;
}

export function calculateGraphMetrics(
  pages: readonly AnalyzedPage[],
  startUrl: string,
): PageGraphMetric[] {
  const pageUrls = new Set(pages.map((page) => page.normalizedUrl));
  const incoming = new Map<string, number>();
  for (const page of pages) {
    for (const target of new Set(page.internalTargets)) {
      if (pageUrls.has(target))
        incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  return pages.map((page) => {
    const incomingCount = incoming.get(page.normalizedUrl) ?? 0;
    return {
      pageUrl: page.normalizedUrl,
      crawlDepth: page.depth,
      incomingInternalLinks: incomingCount,
      outgoingInternalLinks: new Set(page.internalTargets).size,
      isOrphan:
        page.normalizedUrl !== startUrl &&
        page.inSitemap &&
        incomingCount === 0,
    };
  });
}

export function analyzeTechnicalIssues(
  pages: readonly AnalyzedPage[],
  startUrl: string,
): { readonly issues: TechnicalIssue[]; readonly metrics: PageGraphMetric[] } {
  const issues: TechnicalIssue[] = [];
  const metrics = calculateGraphMetrics(pages, startUrl);
  const pageByUrl = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const titleGroups = new Map<string, string[]>();
  const descriptionGroups = new Map<string, string[]>();

  for (const page of pages) {
    const url = page.normalizedUrl;
    if (
      page.httpStatus !== null &&
      page.httpStatus >= 400 &&
      page.httpStatus < 500
    )
      issues.push(
        issue(
          "HTTP_4XX",
          "ERROR",
          url,
          { status: page.httpStatus },
          "Restore the page or redirect obsolete URLs to an appropriate replacement.",
        ),
      );
    if (page.httpStatus !== null && page.httpStatus >= 500)
      issues.push(
        issue(
          "HTTP_5XX",
          "CRITICAL",
          url,
          { status: page.httpStatus },
          "Investigate and resolve the server-side failure.",
        ),
      );
    if (page.redirectLoop)
      issues.push(
        issue(
          "REDIRECT_LOOP",
          "CRITICAL",
          url,
          {},
          "Replace the loop with a single redirect to a final destination.",
        ),
      );
    else if (page.redirectCount > 1)
      issues.push(
        issue(
          "REDIRECT_CHAIN",
          "WARNING",
          url,
          { hops: page.redirectCount },
          "Point links and redirects directly at the final URL.",
        ),
      );

    if (page.indexabilityReason === "NOINDEX")
      issues.push(
        issue(
          "NOINDEX",
          "WARNING",
          url,
          {},
          "Confirm that the noindex directive is intentional.",
        ),
      );
    if (page.indexabilityReason === "ROBOTS_DISALLOWED")
      issues.push(
        issue(
          "ROBOTS_BLOCKED",
          "WARNING",
          url,
          {},
          "Confirm the robots.txt disallow rule is intentional.",
        ),
      );
    if (page.inSitemap && !page.isIndexable)
      issues.push(
        issue(
          "SITEMAP_NON_INDEXABLE",
          "ERROR",
          url,
          { reason: page.indexabilityReason },
          "Remove the URL from the sitemap or make it indexable.",
        ),
      );

    if (
      page.httpStatus !== null &&
      page.httpStatus >= 200 &&
      page.httpStatus < 300
    ) {
      if (page.canonicalUrl === null)
        issues.push(
          issue(
            "CANONICAL_MISSING",
            "WARNING",
            url,
            {},
            "Add a valid canonical URL.",
          ),
        );
      if (page.title === null || page.title.trim() === "")
        issues.push(
          issue(
            "TITLE_MISSING",
            "ERROR",
            url,
            {},
            "Add a concise, unique HTML title.",
          ),
        );
      else {
        const key = page.title.trim().toLocaleLowerCase();
        titleGroups.set(key, [...(titleGroups.get(key) ?? []), url]);
        if (page.title.length < 10 || page.title.length > 65)
          issues.push(
            issue(
              "TITLE_LENGTH",
              "WARNING",
              url,
              { length: page.title.length },
              "Review the title for a concise search-friendly length.",
            ),
          );
      }
      if (page.metaDescription === null || page.metaDescription.trim() === "")
        issues.push(
          issue(
            "META_DESCRIPTION_MISSING",
            "WARNING",
            url,
            {},
            "Add a useful meta description.",
          ),
        );
      else {
        const key = page.metaDescription.trim().toLocaleLowerCase();
        descriptionGroups.set(key, [
          ...(descriptionGroups.get(key) ?? []),
          url,
        ]);
      }
      const h1Count = page.headings.filter(
        (heading) => heading.level === 1,
      ).length;
      if (h1Count === 0)
        issues.push(
          issue(
            "H1_MISSING",
            "WARNING",
            url,
            {},
            "Add one descriptive H1 heading.",
          ),
        );
      if (h1Count > 1)
        issues.push(
          issue(
            "H1_MULTIPLE",
            "WARNING",
            url,
            { count: h1Count },
            "Use one primary H1 and structure subsections with lower heading levels.",
          ),
        );
      if (page.wordCount < 100)
        issues.push(
          issue(
            "THIN_CONTENT",
            "INFO",
            url,
            { wordCount: page.wordCount },
            "Confirm the page contains enough useful content for its purpose.",
          ),
        );
      if (page.missingAltCount > 0)
        issues.push(
          issue(
            "IMAGE_ALT_MISSING",
            "WARNING",
            url,
            { missing: page.missingAltCount, total: page.imageCount },
            "Add meaningful alt text to informative images and empty alt text to decorative images.",
          ),
        );
    }

    if (page.depth > 4)
      issues.push(
        issue(
          "CRAWL_DEPTH_EXCESSIVE",
          "WARNING",
          url,
          { depth: page.depth },
          "Add relevant internal links that reduce crawl depth.",
        ),
      );

    for (const target of new Set(page.internalTargets)) {
      const destination = pageByUrl.get(target);
      if (
        destination?.httpStatus !== null &&
        destination !== undefined &&
        destination.httpStatus >= 400
      )
        issues.push(
          issue(
            "BROKEN_INTERNAL_LINK",
            "ERROR",
            url,
            { target, status: destination.httpStatus },
            "Update or remove the internal link.",
          ),
        );
      if (destination !== undefined && destination.redirectCount > 0)
        issues.push(
          issue(
            "INTERNAL_LINK_TO_REDIRECT",
            "WARNING",
            url,
            { target },
            "Point the internal link directly to the final URL.",
          ),
        );
    }
  }

  for (const urls of titleGroups.values())
    if (urls.length > 1)
      for (const url of urls)
        issues.push(
          issue(
            "TITLE_DUPLICATE",
            "WARNING",
            url,
            { matchingUrls: urls },
            "Give each indexable page a distinct title.",
          ),
        );
  for (const urls of descriptionGroups.values())
    if (urls.length > 1)
      for (const url of urls)
        issues.push(
          issue(
            "META_DESCRIPTION_DUPLICATE",
            "WARNING",
            url,
            { matchingUrls: urls },
            "Give each important page a distinct meta description.",
          ),
        );
  for (const metric of metrics)
    if (metric.isOrphan)
      issues.push(
        issue(
          "ORPHAN_PAGE",
          "ERROR",
          metric.pageUrl,
          {},
          "Add a relevant internal link to the sitemap page.",
        ),
      );

  return { issues, metrics };
}

export interface SnapshotComparable {
  readonly normalizedUrl: string;
  readonly httpStatus: number | null;
  readonly title: string | null;
  readonly canonicalUrl: string | null;
  readonly isIndexable: boolean;
  readonly contentHash: string | null;
  readonly internalTargets: readonly string[];
}

export interface SnapshotChange {
  readonly normalizedUrl: string;
  readonly changedFields: readonly string[];
  readonly addedLinks: readonly string[];
  readonly removedLinks: readonly string[];
}

export function compareSnapshots(
  previous: readonly SnapshotComparable[],
  current: readonly SnapshotComparable[],
): SnapshotChange[] {
  const before = new Map(previous.map((page) => [page.normalizedUrl, page]));
  const changes: SnapshotChange[] = [];
  for (const page of current) {
    const old = before.get(page.normalizedUrl);
    if (old === undefined) continue;
    const changedFields = (
      [
        "httpStatus",
        "title",
        "canonicalUrl",
        "isIndexable",
        "contentHash",
      ] as const
    ).filter((field) => old[field] !== page[field]);
    const oldLinks = new Set(old.internalTargets);
    const newLinks = new Set(page.internalTargets);
    const addedLinks = [...newLinks].filter((link) => !oldLinks.has(link));
    const removedLinks = [...oldLinks].filter((link) => !newLinks.has(link));
    if (
      changedFields.length > 0 ||
      addedLinks.length > 0 ||
      removedLinks.length > 0
    )
      changes.push({
        normalizedUrl: page.normalizedUrl,
        changedFields,
        addedLinks,
        removedLinks,
      });
  }
  return changes;
}
