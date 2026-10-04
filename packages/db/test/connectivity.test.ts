import type { QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  probeDatabase,
  probeQueueSchema,
  type Queryable,
} from "../src/index.js";

describe("database probes", () => {
  it("reports database availability", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });

    await expect(probeDatabase({ query } as Queryable)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith("select 1");
  });

  it("reports database failure without leaking the error", async () => {
    const query = vi.fn().mockRejectedValue(new Error("password=secret"));

    await expect(probeDatabase({ query } as Queryable)).resolves.toBe(false);
  });

  it("requires the pg-boss schema for queue readiness", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ ready: false }] } as QueryResult);

    await expect(probeQueueSchema({ query } as Queryable)).resolves.toBe(false);
  });
});
