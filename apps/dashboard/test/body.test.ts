import { describe, it, expect } from "vitest";
import { boundedText, BodyLimitError } from "../lib/body";
describe("bounded dashboard request bodies", () => {
  it("accepts UTF-8 and rejects declared or streaming oversized payloads", async () => {
    expect(
      await boundedText(
        new Request("http://localhost", { method: "POST", body: "متن" }),
        20,
      ),
    ).toBe("متن");
    await expect(
      boundedText(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-length": "100" },
          body: "small",
        }),
        20,
      ),
    ).rejects.toBeInstanceOf(BodyLimitError);
    await expect(
      boundedText(
        new Request("http://localhost", { method: "POST", body: "long body" }),
        5,
      ),
    ).rejects.toBeInstanceOf(BodyLimitError);
  });
});
