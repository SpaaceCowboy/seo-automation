export interface RenderFallbackPolicy {
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly RegExp[];
  readonly maximumRenderedPages: number;
}

export interface RenderFallbackEvidence {
  readonly url: string;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly extractedWordCount: number;
  readonly hasMeaningfulLinks: boolean;
}

export function shouldUsePlaywrightFallback(
  evidence: RenderFallbackEvidence,
  policy: RenderFallbackPolicy,
  renderedCount: number,
): boolean {
  if (!policy.enabled || renderedCount >= policy.maximumRenderedPages)
    return false;
  if (evidence.httpStatus !== 200 || evidence.contentType !== "text/html")
    return false;
  if (!policy.allowedUrlPatterns.some((pattern) => pattern.test(evidence.url)))
    return false;
  return evidence.extractedWordCount < 20 && !evidence.hasMeaningfulLinks;
}
