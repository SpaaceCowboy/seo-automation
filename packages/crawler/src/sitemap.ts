import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface ParsedSitemap {
  readonly type: "URLSET" | "INDEX";
  readonly entries: readonly {
    readonly url: string;
    readonly lastModified: string | null;
  }[];
}

function asArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : ([value] as readonly T[]);
}

export function parseSitemap(xml: string): ParsedSitemap {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error("Malformed sitemap XML");
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const document = parser.parse(xml) as {
    urlset?: {
      url?:
        | { loc?: unknown; lastmod?: unknown }
        | readonly { loc?: unknown; lastmod?: unknown }[];
    };
    sitemapindex?: {
      sitemap?:
        | { loc?: unknown; lastmod?: unknown }
        | readonly { loc?: unknown; lastmod?: unknown }[];
    };
  };
  if (document.urlset !== undefined) {
    const entries = asArray(document.urlset.url)
      .filter((entry) => typeof entry.loc === "string")
      .map((entry) => ({
        url: entry.loc as string,
        lastModified: typeof entry.lastmod === "string" ? entry.lastmod : null,
      }));
    return { type: "URLSET", entries };
  }
  if (document.sitemapindex !== undefined) {
    const entries = asArray(document.sitemapindex.sitemap)
      .filter((entry) => typeof entry.loc === "string")
      .map((entry) => ({
        url: entry.loc as string,
        lastModified: typeof entry.lastmod === "string" ? entry.lastmod : null,
      }));
    return { type: "INDEX", entries };
  }
  throw new Error("Unsupported sitemap document");
}
