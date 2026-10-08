import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createServiceAccountTokenProvider,
  createGscClient,
} from "../src/index.js";

describe("Google production boundaries", () => {
  it("rejects credential-file token endpoint overrides before egress", async () => {
    const directory = await mkdtemp(join(tmpdir(), "google-secret-"));
    const file = join(directory, "credential.json"),
      fetcher = vi.fn();
    try {
      await writeFile(
        file,
        JSON.stringify({
          client_email: "service@example.test",
          private_key: "secret",
          token_uri: "https://untrusted.example.test/token",
        }),
      );
      await expect(
        createServiceAccountTokenProvider({
          credentialFile: file,
          scopes: [],
          fetcher,
        }).getAccessToken(),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("bounds token exchange and caches only in memory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "google-token-")),
      file = join(directory, "credential.json");
    const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({ access_token: "fixture-token", expires_in: 3600 }),
        );
      },
    );
    try {
      await writeFile(
        file,
        JSON.stringify({
          client_email: "service@example.test",
          private_key: key,
        }),
      );
      const provider = createServiceAccountTokenProvider({
        credentialFile: file,
        scopes: ["readonly"],
        fetcher,
      });
      expect(await provider.getAccessToken()).toBe("fixture-token");
      expect(await provider.getAccessToken()).toBe("fixture-token");
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("stops an endless paginated response instead of retaining unbounded rows", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rows: [
              {
                keys: ["2026-09-01", "https://example.test/", "irn", "MOBILE"],
                clicks: 1,
                impressions: 100,
                ctr: 0.01,
                position: 7,
              },
            ],
          }),
        ),
    );
    const client = createGscClient({
      tokenProvider: { getAccessToken: async () => "fixture" },
      policy: { timeoutMs: 1000, retryLimit: 0, requestsPerSecond: 100000 },
      fetcher,
    });
    await expect(
      client.queryAll({
        property: "sc-domain:example.test",
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        dimensionSet: "PAGE",
        rowLimit: 1,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_LIMIT" });
    expect(fetcher).toHaveBeenCalledTimes(100);
    await expect(
      client.queryAll({
        property: "sc-domain:example.test",
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        dimensionSet: "PAGE",
        rowLimit: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROW_LIMIT" });
  });
});
