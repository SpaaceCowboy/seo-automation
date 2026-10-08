import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  migrateDatabase,
  createControlRepository,
  createWorkflowRepository,
  createMeasurementRepository,
} from "../../packages/db/src/index.js";
import { createLogger } from "../../packages/shared/src/index.js";
import { buildApp } from "../../apps/api/src/app.js";
import { seedControl } from "./fixture.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error(
    "An isolated local TEST_DATABASE_URL ending in _test is required.",
  );
const db = createDatabase(url),
  workflow = createWorkflowRepository(db.db),
  measurements = createMeasurementRepository(db.db),
  control = createControlRepository(db.db);
const operatorToken = randomUUID() + randomUUID(),
  viewerToken = randomUUID() + randomUUID();
let fixture: Awaited<ReturnType<typeof seedControl>>,
  app: ReturnType<typeof buildApp>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await migrateDatabase(db.pool);
  fixture = await seedControl(db.pool);
  const access = JSON.stringify([
    {
      token: operatorToken,
      actorId: fixture.operatorId,
      roles: ["OPERATOR", "APPROVER"],
    },
    { token: viewerToken, actorId: fixture.reviewerId, roles: ["VIEWER"] },
  ]);
  app = buildApp({
    logger: createLogger({
      service: "dashboard-e2e",
      environment: "test",
      level: "silent",
    }),
    readiness: () => Promise.resolve({ database: true, queue: true }),
    control,
    workflowAccess: access,
    workflow: {
      async invoke(op, site, id, body, p) {
        switch (op) {
          case "CREATE":
            return workflow.create(site, body, p);
          case "DETAIL":
            return workflow.detail(site, id!, p);
          case "LIST":
            return workflow.list(site, body, p);
          case "TRANSITION":
            return workflow.transition(site, id!, body, p);
          case "IMPLEMENT":
            return workflow.implement(site, id!, body, p);
          case "REVISE":
            return workflow.revise(site, id!, body, p);
          case "LEDGER":
            return workflow.ledger(site, id!, p);
          case "HISTORY":
            return measurements.history(site, id!, p);
          case "MEASURE30":
          case "MEASURE60":
          case "MEASURE90":
            return measurements.createRun(
              site,
              id!,
              Number(op.slice(7)) as 30 | 60 | 90,
              body,
              p,
            );
          default:
            throw new Error("Unsupported fixture operation");
        }
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port: 4017 });
});
test.afterAll(async () => {
  await app?.close();
  await db.close();
});
async function login(page: Page, token = operatorToken) {
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("Named access credential").fill(token);
  const responsePromise = page.waitForResponse((r) =>
    r.url().endsWith("/api/session"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(token);
  await page.getByLabel("Site", { exact: true }).selectOption(fixture.siteId);
  await expect(
    page.getByText("Latest crawl attempt", { exact: true }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name, exact: true }).first(),
  ).toBeVisible();
}
async function createProposal(
  page: Page,
  title: string,
  summary = "Review title clarity using stored CTR evidence",
) {
  await nav(page, "Opportunities");
  await page
    .getByRole("button", { name: "Open CTR", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Priority");
  await page
    .getByRole("button", { name: "View related agent recommendations" })
    .click();
  await page
    .locator("tbody tr")
    .filter({ hasText: summary })
    .getByRole("button", { name: /Open/ })
    .click();
  await page.getByRole("button", { name: "Create review proposal" }).click();
  await page.getByLabel("Before · Title", { exact: true }).fill("Old title");
  await page.getByLabel("Proposed after · Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save draft for review" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Approval records a decision",
  );
  await page
    .getByLabel("Review reason")
    .fill("Evidence checked in isolated sandbox");
  await page.getByRole("button", { name: "SUBMIT", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("READY FOR REVIEW");
}

test("private overview, crawl/Google evidence, filters, freshness and RTL", async ({
  page,
}) => {
  expect((await page.request.get("/api/control/control/sites")).status()).toBe(
    401,
  );
  await login(page);
  await expect(
    page.getByRole("button", { name: /Pages crawled/ }),
  ).toContainText("1");
  await nav(page, "Crawl history");
  await expect(page.locator("tbody")).toContainText("SUCCEEDED");
  await nav(page, "Technical health");
  await expect(page.locator("tbody")).toContainText("MISSING META DESCRIPTION");
  await page.getByLabel("Severity", { exact: true }).selectOption("CRITICAL");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching technical health" }),
  ).toBeVisible();
  await nav(page, "Search performance");
  await expect(page.locator(".performance-metrics")).toContainText("56");
  await expect(page.locator(".performance-metrics")).toContainText("2%");
  await expect(page.getByText("Daily observations · PAGE")).toBeVisible();
  await page.getByLabel("Dataset").selectOption("QUERY");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching search performance" }),
  ).toBeVisible();
  await page.getByLabel("Dataset").selectOption("GA4");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".performance-metrics")).toContainText("70%");
  await page.getByLabel("Dataset").selectOption("PAGESPEED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("tbody")).toContainText("1,100");
  await nav(page, "Data freshness");
  await expect(page.locator("tbody")).toContainText("GOOGLE_UNAVAILABLE");
  await expect(page.locator("tbody")).toContainText("NO_SUCCESSFUL_DATA");
  await nav(page, "Alerts / failures");
  await expect(page.locator("tbody")).toContainText("GA4 sync problem");
  await page.getByRole("button", { name: "فارسی / RTL" }).click();
  await expect(page.locator(".workspace")).toHaveAttribute("dir", "rtl");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tmp/phase7-mobile-rtl.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await nav(page, "Overview");
  await page.screenshot({ path: "tmp/phase7-overview.png", fullPage: true });
});

test("opportunity to exact review, approval, manual sandbox ledger and measurement state", async ({
  page,
}) => {
  await login(page);
  await createProposal(page, "Approved sandbox title");
  await page
    .getByLabel("Review reason")
    .fill("Approve exact title version with evidence");
  await page.getByRole("button", { name: "APPROVE", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Record manual implementation" }),
  ).toBeVisible();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Applied at (your local time)").fill(
    new Date()
      .toISOString()
      .slice(0, 23)
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "")
      .replace(/T(\d{2}:\d{2}):00$/, "T$1"),
  );
  await dialog.getByLabel("External reference").fill("sandbox-validation-7");
  await dialog
    .getByLabel("Implementation notes")
    .fill("Human attestation in sandbox. No real website was touched.");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Record manual implementation", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Baseline and 30 / 60 / 90 days" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Approved sandbox title");
  await expect(dialog).toContainText("SANDBOX");
  await expect(dialog).toContainText("GSC_CTR");
  const ledgerCount = await db.pool.query<{ count: number }>(
    "select count(*)::int as count from change_ledger_entries where site_id=$1 and mode='SANDBOX'",
    [fixture.siteId],
  );
  expect(ledgerCount.rows[0]?.count).toBe(1);
  await dialog
    .getByRole("button", { name: "Request T+30 measurement" })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toContainText("has not matured");
  await dialog.getByRole("button", { name: "Close detail" }).click();
  await nav(page, "Measurements");
  await expect(page.locator("tbody")).toContainText("GSC_CTR");
});

test("viewer permissions, stale transitions, CSRF and revoked sessions", async ({
  page,
}) => {
  await login(page, viewerToken);
  await nav(page, "Review queue");
  await page
    .locator("tbody tr")
    .filter({ hasText: "IMPLEMENTED" })
    .getByRole("button", { name: "Open TITLE" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Approved sandbox title",
  );
  await expect(
    page.getByRole("button", { name: "APPROVE", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Record manual implementation",
      exact: true,
    }),
  ).toHaveCount(0);
  const rec = (
    await db.pool.query<{ id: string; current_version_id: string }>(
      "select id,current_version_id from recommendations where site_id=$1 and state='IMPLEMENTED' limit 1",
      [fixture.siteId],
    )
  ).rows[0]!;
  const denied = await app.inject({
    method: "POST",
    url: `/sites/${fixture.siteId}/workflow/recommendations/${rec.id}/decisions`,
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: {
      expectedVersionId: rec.current_version_id,
      expectedState: "IMPLEMENTED",
      action: "APPROVE",
      reason: "Attempt without authority",
    },
  });
  expect(denied.statusCode).toBe(403);
  const stale = await app.inject({
    method: "POST",
    url: `/sites/${fixture.siteId}/workflow/recommendations/${rec.id}/decisions`,
    headers: { authorization: `Bearer ${operatorToken}` },
    payload: {
      expectedVersionId: randomUUID(),
      expectedState: "READY_FOR_REVIEW",
      action: "APPROVE",
      reason: "Stale review",
    },
  });
  expect(stale.statusCode).toBe(409);
  expect(
    (
      await page.request.post(
        `/api/control/sites/${fixture.siteId}/workflow/recommendations`,
        { data: {}, headers: { origin: "https://evil.test" } },
      )
    ).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Close detail" }).click();
  const oldCookie = (await page.context().cookies()).find(
    (c) => c.name === "roco_session",
  )!;
  expect(oldCookie.httpOnly).toBe(true);
  expect(oldCookie.sameSite).toBe("Strict");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/sign-in/);
  expect((await page.request.get("/api/control/control/sites")).status()).toBe(
    401,
  );
  expect(
    (
      await page.request.get("/api/control/control/sites", {
        headers: { cookie: `roco_session=${oldCookie.value}` },
      })
    ).status(),
  ).toBe(401);
});

test("request changes, revise and reject without creating an implementation", async ({
  page,
}) => {
  await login(page);
  await createProposal(
    page,
    "Proposal needing changes",
    "Second title candidate for rejection",
  );
  await page.getByLabel("Review reason").fill("Needs a clearer semantic title");
  await page
    .getByRole("button", { name: "REQUEST CHANGES", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("CHANGES REQUESTED");
  await page.getByRole("button", { name: "Revise exact proposal" }).click();
  await page
    .getByLabel("Proposed after · Title", { exact: true })
    .fill("Revised proposal rejected by reviewer");
  await page.getByRole("button", { name: "Save draft for review" }).click();
  await expect(page.getByRole("dialog")).toContainText("Version 2");
  await page
    .getByLabel("Review reason")
    .fill("Resubmit reviewed concrete revision");
  await page.getByRole("button", { name: "SUBMIT", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("READY FOR REVIEW");
  await page
    .getByLabel("Review reason")
    .fill("Insufficient semantic fit for this page");
  await page.getByRole("button", { name: "REJECT", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("REJECTED");
  await expect(
    page.getByRole("button", {
      name: "Record manual implementation",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await db.pool.query<{ count: number }>(
        "select count(*)::int as count from change_ledger_entries where site_id=$1",
        [fixture.siteId],
      )
    ).rows[0]?.count,
  ).toBe(1);
});
