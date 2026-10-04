import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

describe("structured logging", () => {
  it("redacts configured secret paths", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = pino(
      {
        redact: { paths: ["databaseUrl"], censor: "[REDACTED]" },
      },
      destination,
    );

    logger.info({ databaseUrl: "postgresql://secret" }, "configured");

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record.databaseUrl).toBe("[REDACTED]");
    expect(record.msg).toBe("configured");
  });
});
