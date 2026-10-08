import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
          MODERATION_MODE: "owner-only",
          OPENAI_API_KEY: "test-openai-key",
          ADMIN_REVIEW_SECRET: "test-admin-secret",
        },
      },
    })),
  ],
  test: {
    exclude: [...configDefaults.exclude, "**/.agents/**", "**/.claude/**"],
    setupFiles: ["./test/setup.ts"],
  },
});
