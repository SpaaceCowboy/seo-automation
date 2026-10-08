import { z } from "zod";
export const sectionSchema = z.enum([
  "overview",
  "crawls",
  "issues",
  "performance",
  "opportunities",
  "agents",
  "recommendations",
  "changes",
  "measurements",
  "freshness",
  "signals",
]);
export type ControlSection = z.infer<typeof sectionSchema>;
export const controlFilterSchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    status: z.string().max(40).optional(),
    type: z.string().max(80).optional(),
    severity: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]).optional(),
    pageId: z.string().uuid().optional(),
    pageUrl: z.string().url().max(2048).optional(),
    crawlId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    minScore: z.coerce.number().min(0).max(100).optional(),
    sort: z.enum(["score", "recent"]).default("score"),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    dataset: z
      .enum(["PAGE", "QUERY", "PAGE_QUERY", "GA4", "PAGESPEED"])
      .default("PAGE"),
    strategy: z.enum(["mobile", "desktop"]).default("mobile"),
  })
  .superRefine((f, ctx) => {
    if (Boolean(f.startDate) !== Boolean(f.endDate))
      ctx.addIssue({ code: "custom", message: "Both dates are required" });
    if (f.dataset === "QUERY" && (f.pageId || f.pageUrl))
      ctx.addIssue({
        code: "custom",
        message: "QUERY dataset has no page dimension",
      });
    if (f.startDate && f.endDate) {
      const days = (Date.parse(f.endDate) - Date.parse(f.startDate)) / 86400000;
      if (days < 0 || days > 92)
        ctx.addIssue({
          code: "custom",
          message: "Date range must be between 1 and 93 days",
        });
    }
  });
export type ControlFilter = z.infer<typeof controlFilterSchema>;
export const controlRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  kind: z.string().nullable().default(null),
  severity: z.string().nullable().default(null),
  score: z.number().nullable().default(null),
  at: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ControlRow = z.infer<typeof controlRowSchema>;
export const controlListSchema = z.object({
  items: z.array(controlRowSchema),
  hasMore: z.boolean(),
  limit: z.number(),
  offset: z.number(),
  notes: z.array(z.string()).default([]),
  summary: z.record(z.string(), z.unknown()).default({}),
});
export type ControlList = z.infer<typeof controlListSchema>;
export const siteListSchema = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    canonicalOrigin: z.string(),
    timezone: z.string(),
    status: z.string(),
  }),
);
export const identitySchema = z.object({
  actorId: z.string().uuid(),
  displayName: z.string(),
  roles: z.array(z.string()),
});
export type ControlIdentity = z.infer<typeof identitySchema>;
