export interface RobotsRule {
  readonly type: "allow" | "disallow";
  readonly path: string;
}

export interface ParsedRobots {
  readonly rules: readonly RobotsRule[];
  readonly sitemaps: readonly string[];
  readonly crawlDelaySeconds: number | null;
  isAllowed(url: string): boolean;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export function parseRobots(content: string, userAgent: string): ParsedRobots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | undefined;
  let hasRule = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (line === "" || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "sitemap" && value !== "") {
      sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (current === undefined || hasRule) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
        hasRule = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (current === undefined) continue;
    if ((field === "allow" || field === "disallow") && value !== "") {
      current.rules.push({ type: field, path: value });
      hasRule = true;
    } else if (field === "crawl-delay") {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0)
        current.crawlDelaySeconds = delay;
      hasRule = true;
    }
  }

  const normalizedAgent = userAgent.toLowerCase();
  const matches = groups.filter((group) =>
    group.agents.some(
      (agent) => agent === "*" || normalizedAgent.includes(agent),
    ),
  );
  const specific = matches.filter((group) =>
    group.agents.some(
      (agent) => agent !== "*" && normalizedAgent.includes(agent),
    ),
  );
  const selected = specific.length > 0 ? specific : matches;
  const rules = selected.flatMap((group) => group.rules);
  const delays = selected
    .map((group) => group.crawlDelaySeconds)
    .filter((value): value is number => value !== null);
  const crawlDelaySeconds = delays.length === 0 ? null : Math.max(...delays);

  return {
    rules,
    sitemaps: [...new Set(sitemaps)],
    crawlDelaySeconds,
    isAllowed(urlString) {
      const url = new URL(urlString);
      const path = `${url.pathname}${url.search}`;
      const matching = rules
        .filter((rule) => path.startsWith(rule.path.replace(/\*.*$/u, "")))
        .sort((left, right) => right.path.length - left.path.length);
      if (matching.length === 0) return true;
      return matching[0]?.type === "allow";
    },
  };
}
