import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import { isInternalUrl, normalizeUrl, type SiteScope } from "@roco/seo-core";

import type { ExtractedPage } from "./types.js";

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function directives(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,]/u)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function collectSchemaTypes(value: unknown, target: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, target);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") target.add(type);
  else if (Array.isArray(type))
    for (const item of type) if (typeof item === "string") target.add(item);
  for (const child of Object.values(record)) collectSchemaTypes(child, target);
}

export function extractHtml(
  html: string,
  pageUrl: string,
  scope: SiteScope,
  ignoredQueryParameters: readonly string[] = [],
): ExtractedPage {
  const $ = cheerio.load(html);
  const title = cleanText($("title").first().text()) || null;
  const metaDescription =
    cleanText($("meta[name='description' i]").first().attr("content") ?? "") ||
    null;
  const canonicalHref = $("link[rel~='canonical' i]").first().attr("href");
  let canonicalUrl: string | null = null;
  if (canonicalHref !== undefined && canonicalHref.trim() !== "") {
    try {
      canonicalUrl = normalizeUrl(canonicalHref, pageUrl, {
        ignoredQueryParameters,
      }).normalizedUrl;
    } catch {
      canonicalUrl = null;
    }
  }
  const headings = $("h1,h2")
    .toArray()
    .map<{ level: 1 | 2; position: number; text: string }>(
      (element, position) => ({
        level: element.tagName.toLowerCase() === "h1" ? 1 : 2,
        position,
        text: cleanText($(element).text()),
      }),
    )
    .filter((heading) => heading.text !== "");

  const schemaTypes = new Set<string>();
  $("script[type='application/ld+json']").each((_index, element) => {
    try {
      collectSchemaTypes(JSON.parse($(element).text()) as unknown, schemaTypes);
    } catch {
      // Malformed JSON-LD remains observable through an empty parsed type set.
    }
  });

  $("script,style,noscript,template").remove();

  const images = $("img")
    .toArray()
    .map((element) => ({
      sourceUrl: $(element).attr("src") ?? null,
      altText: $(element).attr("alt") ?? null,
      hasAltAttribute: $(element).attr("alt") !== undefined,
    }));

  const links = $("a[href]")
    .toArray()
    .flatMap((element) => {
      const href = $(element).attr("href");
      if (href === undefined || href.trim() === "") return [];
      try {
        const normalized = normalizeUrl(href, pageUrl, {
          ignoredQueryParameters,
        }).normalizedUrl;
        return [
          {
            observedUrl: href,
            normalizedUrl: normalized,
            anchorText: cleanText($(element).text()) || null,
            rel: cleanText($(element).attr("rel") ?? "") || null,
            isInternal: isInternalUrl(normalized, scope),
          },
        ];
      } catch {
        return [];
      }
    });

  const bodyText = cleanText($("body").text());
  const words = bodyText === "" ? [] : bodyText.split(/\s+/u);
  const contentHash = createHash("sha256").update(bodyText).digest("hex");
  const htmlHash = createHash("sha256").update(html).digest("hex");
  const metaRobots = directives(
    $("meta[name='robots' i]").first().attr("content"),
  );

  return {
    title,
    metaDescription,
    canonicalUrl,
    metaRobots,
    headings,
    schemaTypes: [...schemaTypes].sort(),
    hasBreadcrumbs: schemaTypes.has("BreadcrumbList"),
    images,
    links,
    wordCount: words.length,
    contentHash,
    htmlHash,
  };
}
