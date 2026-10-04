export const TEST_DATABASE_URL =
  "postgresql://roco_seo:roco_seo_dev@127.0.0.1:5432/roco_seo_test";

export function createTestEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    ...overrides,
  };
}
