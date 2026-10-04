import { afterEach, describe, expect, it, vi } from "vitest";
import { articleCacheKey } from "../src/lib/cache";
import { decodeCursor, encodeCursor } from "../src/lib/cursor";
import {
  embedAccentForeground,
  embedQuery,
  issueMatchesEmbedFilters,
  parseEmbedOptions,
} from "../src/lib/embed";
import { normalizeGitHubHtml } from "../src/lib/github-html";
import { renderGitHubMarkdown } from "../src/lib/github-markdown";
import {
  decodeReaderCursor,
  encodeReaderCursor,
  GITHUB_READER_POLICY,
  parsePublicRepository,
} from "../src/lib/github-reader";
import { renderMarkdown } from "../src/lib/markdown";
import { checkContentSafety } from "../src/lib/safety";
import { verifyGitHubSignature } from "../src/lib/signature";
import { slugify } from "../src/lib/slug";
import { detectSpam } from "../src/lib/spam";
import { logWebhookOutcome } from "../src/lib/webhook-log";
import type { AppBindings, GitHubIssue } from "../src/types";
import { parityGitHubHtml, parityMarkdown } from "./fixtures/github-markdown";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("content primitives", () => {
  it("namespaces rendered article caches by schema", () => {
    expect(articleCacheKey("https://example.com", 42, 3).url).toBe(
      "https://example.com/__cache/articles/v3/42/3",
    );
  });

  it("chooses a contrast-safe foreground for embed accents", () => {
    expect(embedAccentForeground("#ffffff")).toBe("#000000");
    expect(embedAccentForeground("#000000")).toBe("#ffffff");
    expect(embedAccentForeground("#9d2f2a")).toBe("#ffffff");
    expect(embedAccentForeground("#777777")).toBe("#000000");
  });

  it("creates stable slugs and opaque cursors", () => {
    expect(slugify("  A Page: Worth Keeping!  ")).toBe("a-page-worth-keeping");
    const cursor = encodeCursor("2026-08-25T00:00:00.000Z", 42);
    expect(cursor).not.toContain("=");
    expect(decodeCursor(cursor)).toEqual({ v: 1, sort: "2026-08-25T00:00:00.000Z", id: 42 });
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });

  it("accepts only canonical public repository identifiers", () => {
    expect(parsePublicRepository("octocat/Hello-World")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
    });
    expect(parsePublicRepository("https://github.com/octocat/Hello-World.git")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
    });
    for (const value of [
      "http://github.com/octocat/Hello-World",
      "https://github.com.evil/octocat/Hello-World",
      "https://github.com@evil.test/octocat/Hello-World",
      "https://github.com/octocat/Hello-World/issues/1",
      "https://github.com/octocat/Hello-World?tab=issues",
      "https://github.com/octocat%2Fevil/Hello-World",
      "octocat/../Hello-World",
      "octocat\\Hello-World",
      "localhost:8787/private",
    ]) {
      expect(parsePublicRepository(value), value).toBeNull();
    }
  });

  it("uses bounded opaque cursors for GitHub result pages", () => {
    const cursor = encodeReaderCursor(2);
    expect(cursor).not.toContain("=");
    expect(decodeReaderCursor(cursor)).toBe(2);
    expect(decodeReaderCursor("not-a-cursor")).toBeNull();
    expect(decodeReaderCursor(encodeReaderCursor(501))).toBeNull();
  });

  it("keeps embed styling bounded and serializable", () => {
    const values = new Map([
      ["theme", "dark"],
      ["density", "compact"],
      ["accent", "#12ABEF"],
      ["channel", "frame_42-safe"],
      ["label", "blog"],
      ["author", "octocat"],
      ["variant", "minimal"],
    ]);
    const options = parseEmbedOptions((name) => values.get(name));
    expect(options).toEqual({
      theme: "dark",
      density: "compact",
      accent: "#12abef",
      channel: "frame_42-safe",
      label: "blog",
      author: "octocat",
      variant: "minimal",
    });
    expect(embedQuery(options, { cursor: "page-two" })).toBe(
      "theme=dark&density=compact&accent=%2312abef&channel=frame_42-safe&label=blog&author=octocat&variant=minimal&cursor=page-two",
    );
    const invalidValues = new Map([
      ["theme", "javascript:alert(1)"],
      ["density", "spacious"],
      ["accent", "javascript:alert(1)"],
      ["channel", "not a channel"],
      ["label", `bad${String.fromCodePoint(0)}label`],
      ["author", "not a github login"],
    ]);
    expect(parseEmbedOptions((name) => invalidValues.get(name))).toEqual({
      theme: "auto",
      density: "comfortable",
      accent: "#9d2f2a",
      channel: "",
      label: "",
      author: "",
      variant: "folio",
    });
  });

  it("applies embed author and label filters to individual issues", () => {
    const issue = {
      author: { login: "SarthakAgrawal927" },
      labels: [{ name: "Blog" }],
    };
    expect(issueMatchesEmbedFilters(issue, { author: "sarthakagrawal927", label: "blog" })).toBe(
      true,
    );
    expect(issueMatchesEmbedFilters(issue, { author: "someone-else", label: "blog" })).toBe(false);
    expect(issueMatchesEmbedFilters(issue, { author: "sarthakagrawal927", label: "notes" })).toBe(
      false,
    );
  });

  it("keeps public-reader latency and cache limits explicit", () => {
    expect(GITHUB_READER_POLICY).toEqual({
      freshTtlSeconds: 600,
      softStaleTtlSeconds: 3_600,
      staleTtlSeconds: 604_800,
      timeoutMs: 4_000,
      listPageSize: 12,
    });
  });

  it("renders GFM and removes unsafe HTML", () => {
    const rendered = renderMarkdown(
      '## Safe\n\n- [x] shipped\n\n<script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    );
    expect(rendered.html).toContain("<h2>Safe</h2>");
    expect(rendered.html).toContain('type="checkbox"');
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("blocks empty and link-heavy submissions", () => {
    expect(detectSpam("", "", "issue")).toBe("missing_title");
    expect(detectSpam("A title", "", "issue")).toBe("missing_body");
    const links = Array.from({ length: 14 }, (_, index) => `https://example.com/${index}`).join(
      " ",
    );
    expect(detectSpam("A title", links, "issue")).toBe("link_heavy");
    expect(detectSpam("A title", "<!-- template guidance only -->", "issue")).toBe("missing_body");
  });

  it("allows only the repository owner while the moderation pilot is active", async () => {
    const owner = await checkContentSafety(
      undefined,
      "A pilot page",
      "Enough owner-authored content for the live pilot.",
      "issue",
      {
        mode: "owner-only",
        authorLogin: "SarthakAgrawal927",
        ownerLogin: "sarthakagrawal927",
      },
    );
    expect(owner).toMatchObject({
      publishable: true,
      moderation: { model: "owner-only-pilot", flagged: false },
    });

    const stranger = await checkContentSafety(
      undefined,
      "A held page",
      "Enough non-owner content to reach the moderation gate.",
      "issue",
      {
        mode: "owner-only",
        authorLogin: "another-publisher",
        ownerLogin: "sarthakagrawal927",
      },
    );
    expect(stranger).toMatchObject({ publishable: false, failure: "owner_only_pilot" });
  });

  it("keeps normal OpenAI moderation fail-closed when the key is absent", async () => {
    const result = await checkContentSafety(
      undefined,
      "A public page",
      "Enough content to reach the external moderation gate.",
      "issue",
      {
        mode: "openai",
        authorLogin: "sarthakagrawal927",
        ownerLogin: "sarthakagrawal927",
      },
    );
    expect(result).toMatchObject({
      publishable: false,
      failure: "moderation_not_configured",
    });
  });

  it("normalizes the GitHub issue authoring surface without executable HTML", () => {
    const rendered = normalizeGitHubHtml(parityGitHubHtml, {
      sourceUrl: "https://github.com/sarthakagrawal927/issue-pages/issues/2",
      baseUrl: "https://github.com/sarthakagrawal927/issue-pages/blob/HEAD/",
    });
    expect(rendered.features).toEqual({
      mermaid: true,
      math: true,
      fallbackDiagrams: ["geojson"],
    });
    expect(rendered.html).toContain('<div class="markdown-alert markdown-alert-note"');
    expect(rendered.html).toContain('type="checkbox"');
    expect(rendered.html).toContain('class="highlight highlight-source-js"');
    expect(rendered.html).toContain("<math");
    expect(rendered.html).toContain("data-mermaid");
    expect(rendered.html).toContain("Interactive rendering stays on GitHub");
    expect(rendered.html).toContain('type="color"');
    expect(rendered.html).toContain('value="#0969DA"');
    expect(rendered.html).toContain('id="issuepages-user-content-fn-1"');
    expect(rendered.html).toContain('href="#issuepages-user-content-fn-1"');
    expect(rendered.html).toContain(
      'href="https://github.com/sarthakagrawal927/issue-pages/blob/HEAD/docs/guide.md"',
    );
    expect(rendered.html).not.toContain("<h1");
    expect(rendered.html).not.toContain("math-renderer");
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).not.toContain("onerror");
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("<style");
    expect(rendered.html).not.toContain("<iframe");
  });

  it("resolves relative links and media against the repository, not the issue URL", () => {
    const rendered = normalizeGitHubHtml(
      [
        '<p><a href="docs/guide.md">relative link</a></p>',
        '<p><a href="./nested/../other.md">dot relative link</a></p>',
        '<p><a href="/sarthakagrawal927/issue-pages/wiki">root relative link</a></p>',
        '<p><a href="https://example.com/absolute">absolute link</a></p>',
        '<p><a href="//example.com/protocol-relative">protocol relative link</a></p>',
        '<p><a href="#section">anchor link</a></p>',
        '<p><a href="mailto:hello@example.com">mail link</a></p>',
        '<p><img src="assets/diagram.png" alt="Diagram"></p>',
        '<p><img src="//example.com/protocol.png" alt="Protocol"></p>',
        '<picture><source srcset="assets/dark.png 1x, media/dark@2x.png 2x">',
        '<img src="https://example.com/light.png" alt="Themed"></picture>',
      ].join("\n"),
      {
        sourceUrl: "https://github.com/sarthakagrawal927/issue-pages/issues/2",
        baseUrl: "https://github.com/sarthakagrawal927/issue-pages/blob/HEAD/",
      },
    );

    const blob = "https://github.com/sarthakagrawal927/issue-pages/blob/HEAD";
    expect(rendered.html).toContain(`href="${blob}/docs/guide.md"`);
    expect(rendered.html).toContain(`href="${blob}/other.md"`);
    expect(rendered.html).toContain('href="https://github.com/sarthakagrawal927/issue-pages/wiki"');
    expect(rendered.html).toContain('href="https://example.com/absolute"');
    expect(rendered.html).toContain('href="https://example.com/protocol-relative"');
    expect(rendered.html).toContain('href="#section"');
    expect(rendered.html).toContain('href="mailto:hello@example.com"');
    expect(rendered.html).toContain(`src="${blob}/assets/diagram.png"`);
    expect(rendered.html).toContain('src="https://example.com/protocol.png"');
    expect(rendered.html).toContain(
      `srcset="${blob}/assets/dark.png 1x, ${blob}/media/dark@2x.png 2x"`,
    );
    expect(rendered.html).toContain('src="https://example.com/light.png"');
    expect(rendered.html).not.toContain("/issues/docs/guide.md");
  });

  it("uses GitHub's repository-aware renderer and then normalizes its HTML", async () => {
    const outbound = vi.fn(async (_input: Request | string | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        context?: unknown;
        mode?: unknown;
        text?: unknown;
      };
      expect(payload).toEqual({
        context: "sarthakagrawal927/issue-pages",
        mode: "gfm",
        text: parityMarkdown.trim(),
      });
      return new Response(parityGitHubHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", outbound);

    const rendered = await renderGitHubMarkdown(parityMarkdown, {
      repository: "sarthakagrawal927/issue-pages",
      sourceUrl: "https://github.com/sarthakagrawal927/issue-pages/issues/2",
    });
    expect(rendered.markdown).toBe(parityMarkdown.trim());
    expect(rendered.html).toContain("data-mermaid");
    expect(rendered.html).not.toContain("<script");
    expect(outbound).toHaveBeenCalledOnce();
  });
});

describe("GitHub signature verification", () => {
  it("accepts only the matching HMAC", async () => {
    const body = new TextEncoder().encode('{"zen":"Keep it logically awesome."}');
    const secret = "test-webhook-secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await expect(verifyGitHubSignature(body, `sha256=${hex}`, secret)).resolves.toBe(true);
    await expect(verifyGitHubSignature(body, `sha256=${"0".repeat(64)}`, secret)).resolves.toBe(
      false,
    );
  });
});

describe("App Health webhook logs", () => {
  function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
    return {
      id: 1,
      number: 7,
      title: "How I read a codebase",
      body: "body",
      html_url: "https://github.com/sarthakagrawal927/issue-pages/issues/7",
      state: "open",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      user: { id: 2, login: "stranger", avatar_url: "", html_url: "" },
      labels: [],
      ...overrides,
    };
  }

  const env = { GITHUB_OWNER: "sarthakagrawal927" } as AppBindings;
  const keyed = { ...env, APP_HEALTH_INGEST_KEY: "ah_test", APP_HEALTH_ENVIRONMENT: "production" };

  function captureLogs() {
    const sent: Array<Record<string, unknown>> = [];
    const outbound = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).logs[0]);
      return new Response("{}", { status: 202 });
    });
    vi.stubGlobal("fetch", outbound);
    return { sent, outbound };
  }

  it("stays silent until an ingest key exists", async () => {
    const { outbound } = captureLogs();
    await logWebhookOutcome(env as AppBindings, "processed", {
      eventName: "issues",
      action: "opened",
      issue: issue(),
      authorLogin: "stranger",
    });
    expect(outbound).not.toHaveBeenCalled();
  });

  it("reports a stranger's new article at info", async () => {
    const { sent } = captureLogs();
    await logWebhookOutcome(keyed as AppBindings, "processed", {
      eventName: "issues",
      action: "opened",
      issue: issue(),
      authorLogin: "stranger",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: "article.published",
      level: "info",
      title: "How I read a codebase",
      props: { issue: 7, author: "stranger", stranger: true, action: "opened" },
    });
  });

  it("marks the owner's own publish as not a stranger", async () => {
    const { sent } = captureLogs();
    await logWebhookOutcome(keyed as AppBindings, "processed", {
      eventName: "issues",
      action: "opened",
      issue: issue(),
      authorLogin: "sarthakagrawal927",
    });
    expect(sent[0]).toMatchObject({ props: { stranger: false } });
  });

  it("says nothing when a delivery only refreshed metadata", async () => {
    const { outbound } = captureLogs();
    for (const action of ["labeled", "unlabeled", "closed", "reopened"]) {
      await logWebhookOutcome(keyed as AppBindings, "processed", {
        eventName: "issues",
        action,
        issue: issue(),
        authorLogin: "stranger",
      });
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it("alerts on blocked content without replaying the author's text", async () => {
    const { sent } = captureLogs();
    await logWebhookOutcome(
      keyed as AppBindings,
      "pending",
      {
        eventName: "issues",
        action: "opened",
        issue: issue({ title: "BUY CHEAP FOLLOWERS http://spam.example" }),
        authorLogin: "stranger",
      },
      "flagged",
    );
    expect(sent[0]).toMatchObject({
      event: "article.blocked",
      level: "warn",
      title: "issue #7",
      props: { reason: "flagged" },
    });
    expect(JSON.stringify(sent[0])).not.toContain("spam.example");
  });

  it("raises a failed delivery to error", async () => {
    const { sent } = captureLogs();
    await logWebhookOutcome(
      keyed as AppBindings,
      "failed",
      { eventName: "issues", action: "edited", issue: issue(), authorLogin: "stranger" },
      "github_markdown_failed",
    );
    expect(sent[0]).toMatchObject({
      event: "webhook.failed",
      level: "error",
      props: { reason: "github_markdown_failed" },
    });
  });

  it("never throws when ingest is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network down"))),
    );
    await expect(
      logWebhookOutcome(keyed as AppBindings, "processed", {
        eventName: "issues",
        action: "opened",
        issue: issue(),
        authorLogin: "stranger",
      }),
    ).resolves.toBeUndefined();
  });
});
