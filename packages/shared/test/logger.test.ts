import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";
import { safeErrorMetadata } from "../src/index.js";

describe("structured logging", () => {
  it("keeps diagnostic status while excluding secret-bearing error fields", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = pino(
      { serializers: { err: safeErrorMetadata } },
      destination,
    );
    logger.error(
      {
        err: {
          code: "GOOGLE_API_ERROR",
          status: 429,
          retryable: true,
          message: "secret-token",
          stack: "private SQL",
          cause: { password: "secret" },
        },
      },
      "provider failed",
    );
    expect(JSON.parse(output).err).toEqual({
      code: "GOOGLE_API_ERROR",
      httpStatus: 429,
      retryable: true,
    });
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private SQL");
    expect(
      safeErrorMetadata({ code: "secret/path", status: Infinity }),
    ).toEqual({ code: "UNCLASSIFIED_ERROR" });
  });
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
