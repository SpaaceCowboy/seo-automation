import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSecretFiles } from "../src/index.js";

describe("mounted secrets", () => {
  it("reads bounded files and fails closed without exposing paths or values", () => {
    const directory = mkdtempSync(join(tmpdir(), "roco-secret-test-")),
      file = join(directory, "database");
    try {
      writeFileSync(file, "postgresql://secret-value\n", { mode: 0o600 });
      const env: NodeJS.ProcessEnv = { DATABASE_URL_FILE: file };
      loadSecretFiles(env);
      expect(env.DATABASE_URL).toBe("postgresql://secret-value");
      expect(() => loadSecretFiles(env)).toThrow("configure a value or a file");
      writeFileSync(file, "s".repeat(30001));
      expect(() => loadSecretFiles({ DATABASE_URL_FILE: file })).toThrow(
        "unavailable or too large",
      );
      expect(() =>
        loadSecretFiles({ DATABASE_URL_FILE: directory + "/missing" }),
      ).toThrow("DATABASE_URL_FILE");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
