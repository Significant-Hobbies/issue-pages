import { type AppHealthClient, createAppHealthClient } from "@saas-maker/app-health";
import { honoMiddleware } from "@saas-maker/app-health/hono";
import { type Context, Hono } from "hono";
import { decideModeration, listModerationQueue } from "./admin/handler";
import {
  getArticleByIssueNumber,
  getAuthor,
  getComments,
  getLabel,
  getRandomArticle,
  listArticles,
  searchArticles,
} from "./data/repository";
import { articleCacheKey } from "./lib/cache";
import { type CursorPayload, decodeCursor, encodeCursor } from "./lib/cursor";
import {
  type EmbedOptions,
  embedQuery,
  issueMatchesEmbedFilters,
  parseEmbedOptions,
} from "./lib/embed";
import {
  decodeReaderCursor,
  GitHubReaderError,
  getPublicIssue,
  getPublicIssueDiscussion,
  listPublicIssues,
  type PublicRepository,
  parsePublicRepository,
} from "./lib/github-reader";
import { scheduled } from "./scheduled/reactions";
import type { AppBindings, ArticleListRow } from "./types";
import { articlePollingScript, styles } from "./ui/assets";
import {
  embedDiscussionFragment,
  embedErrorPage,
  embedIssuePage,
  embedLayout,
  embedRepositoryPage,
} from "./ui/embed";
import { embedStyles } from "./ui/embed-assets";
import {
  articlePage,
  authorIntro,
  embedBuilderPage,
  errorPage,
  homePage,
  layout,
  listingPage,
  publicDiscussionFragment,
  publicIssueReaderPage,
  readerErrorPage,
  readerFormPage,
  repositoryReaderPage,
  type SiteIdentity,
  searchPage,
} from "./ui/templates";
import { handleGitHubWebhook } from "./webhooks/handler";

type AppEnv = { Bindings: AppBindings };
const app = new Hono<AppEnv>();
let endpointHealthClient: AppHealthClient | null = null;
const pageSize = 12;
const publicOrigin = "https://issues.sarthakagrawal.dev";
const homepageMarkdown = `# IssuePages

> Open a GitHub issue and leave your page on the internet.

IssuePages turns approved issues from one public publishing repository into readable, searchable pages. GitHub remains the editor, identity, discussion system, and source of truth.

The production site is currently an owner-only pilot. Issues from other authors remain on GitHub and wait for review until public moderation and authenticated rendering are connected.

## Public surfaces

- [Homepage](${publicOrigin}/): Browse the publishing pilot.
- [Newest pages](${publicOrigin}/pages/newest): Browse published pages by date.
- [Read a repository](${publicOrigin}/read): Open an uncatalogued, read-only view of issues from any public GitHub repository.
- [Embed a repository](${publicOrigin}/embed): Build a sandboxed publication embed.
- [Source repository](https://github.com/sarthakagrawal927/issue-pages): Inspect the product and publishing source.
`;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function siteIdentity(env: AppBindings): SiteIdentity {
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    moderationMode: env.MODERATION_MODE === "owner-only" ? "owner-only" : "openai",
  };
}

function securityHeaders(response: Response, embeddable = false): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://sassmaker.com https://health.sassmaker.com https://static.cloudflareinsights.com; connect-src 'self' https://sassmaker.com https://api.sassmaker.com https://ingest.sassmaker.com https://cloudflareinsights.com; frame-ancestors ${embeddable ? "https: http:" : "'none'"}; base-uri 'none'; form-action 'self'`,
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  if (embeddable) headers.delete("X-Frame-Options");
  else headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.use("*", async (c, next) => {
  await next();
  c.res = securityHeaders(c.res, c.req.path.startsWith("/embed/"));
});

app.use(
  "*",
  honoMiddleware<AppEnv>({
    release: "0.1.0",
    client: (c) => {
      const key = c.env.APP_HEALTH_INGEST_KEY;
      if (!key) return null;
      endpointHealthClient ??= createAppHealthClient({
        key,
        environment: c.env.APP_HEALTH_ENVIRONMENT,
        endpoint: "https://ingest.sassmaker.com/v1/ingest",
        runtime: "worker",
        disableTimer: true,
      });
      return endpointHealthClient;
    },
  }),
);

function html(c: Context<AppEnv>, title: string, body: string): Response {
  const response = c.html(layout(siteIdentity(c.env), title, body, { canonicalPath: c.req.path }));
  response.headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  return response;
}

function readerHeaders(
  response: Response,
  cacheState?: "FRESH" | "REFRESHING" | "STALE",
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (cacheState) headers.set("X-IssuePages-Reader-Cache", cacheState);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.use("/read", async (c, next) => {
  await next();
  c.res = readerHeaders(c.res);
});

app.use("/github/*", async (c, next) => {
  await next();
  c.res = readerHeaders(c.res);
});

app.use("/embed/*", async (c, next) => {
  await next();
  c.res = readerHeaders(c.res);
});

function readerHtml(
  c: Context<AppEnv>,
  title: string,
  body: string,
  options: {
    status?: 200 | 400 | 404 | 429 | 503;
    mermaid?: boolean;
    readerClient?: boolean;
    refreshing?: boolean;
    stale?: boolean;
  } = {},
): Response {
  const status = options.status ?? 200;
  const response = c.html(
    layout(siteIdentity(c.env), title, body, {
      canonicalPath: c.req.path,
      description: "Read public GitHub issues as clean, read-only pages.",
      reader: true,
      footerPromotion: status === 200,
      ...(options.readerClient === undefined ? {} : { readerClient: options.readerClient }),
      robots: true,
      ...(options.mermaid === undefined ? {} : { mermaid: options.mermaid }),
    }),
    status,
    {
      "Cache-Control":
        status === 200
          ? "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400"
          : "no-store",
    },
  );
  return readerHeaders(
    response,
    status === 200
      ? options.stale
        ? "STALE"
        : options.refreshing
          ? "REFRESHING"
          : "FRESH"
      : undefined,
  );
}

function readerError(c: Context<AppEnv>, error: unknown): Response {
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const repositoryHref = repository
    ? `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues`
    : undefined;
  const requestUrl = new URL(c.req.url);
  const retryHref = `${requestUrl.pathname}${requestUrl.search}`;
  if (error instanceof GitHubReaderError) {
    if (error.code === "not_found") {
      return readerHtml(
        c,
        "Repository unavailable",
        readerErrorPage(
          404,
          "Public issues unavailable",
          "The repository or issue may be missing, private, or have issues disabled.",
          {
            ...(repositoryHref ? { repositoryHref, repositoryLabel: "Open issues on GitHub" } : {}),
          },
        ),
        { status: 404 },
      );
    }
    const response = readerHtml(
      c,
      "GitHub temporarily unavailable",
      readerErrorPage(
        503,
        "GitHub could not answer",
        error.code === "rate_limited"
          ? "The shared public GitHub allowance is exhausted. Wait a minute and try again."
          : "The public reader could not refresh this repository. Try again shortly.",
        {
          retryHref,
          ...(repositoryHref ? { repositoryHref, repositoryLabel: "Open issues on GitHub" } : {}),
        },
      ),
      { status: 503 },
    );
    response.headers.set("Retry-After", "60");
    return response;
  }
  throw error;
}

function parsePageCursor(
  value: string | undefined,
  expected: "string" | "number",
): CursorPayload | null {
  if (!value) return null;
  const cursor = decodeCursor(value);
  return cursor && typeof cursor.sort === expected ? cursor : null;
}

function nextCursor(
  rows: ArticleListRow[],
  sort: "newest" | "updated",
): { page: ArticleListRow[]; cursor: string | null } {
  const page = rows.slice(0, pageSize);
  if (rows.length <= pageSize) return { page, cursor: null };
  const last = page.at(-1);
  if (!last) return { page, cursor: null };
  const value = sort === "updated" ? last.last_public_at : last.published_at;
  return { page, cursor: encodeCursor(value, last.issue_id) };
}

function appendCursor(path: string, cursor: string | null, query?: string): string | null {
  if (!cursor) return null;
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}

async function withinRateLimit(
  limiter: RateLimit,
  request: Request,
  route: string,
): Promise<boolean> {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  try {
    return (await limiter.limit({ key: `${route}:${address}` })).success;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "rate_limit_unavailable",
        route,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return true;
  }
}

app.get("/styles.css", (c) => {
  return c.body(styles, 200, {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": "text/css; charset=utf-8",
  });
});

app.get("/embed.css", (c) => {
  return c.body(embedStyles, 200, {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": "text/css; charset=utf-8",
  });
});

app.get("/article-poll.js", (c) => {
  return c.body(articlePollingScript, 200, {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": "text/javascript; charset=utf-8",
  });
});

app.get("/healthz", (c) =>
  c.json({ ok: true, service: "issue-pages" }, 200, { "Cache-Control": "no-store" }),
);

app.get("/robots.txt", (c) =>
  c.text(
    `User-agent: *\nAllow: /\nSitemap: ${publicOrigin}/sitemap.xml\n# Agent indexing\nAllow: /llms.txt\nAllow: /index.md\nAllow: /api/ai\n`,
    200,
    { "Cache-Control": "public, max-age=3600" },
  ),
);

app.get("/llms.txt", (c) =>
  c.text(
    `# IssuePages\n\n> A GitHub issue becomes a readable, searchable public page.\n\n## Product\n\n- [Home](${publicOrigin}/): Browse the owner-only publishing pilot\n- [Newest pages](${publicOrigin}/pages/newest): Browse published pages by date\n- [Read any public repository](${publicOrigin}/read): Open an uncatalogued read-only issue publication\n- [Embed a repository](${publicOrigin}/embed): Build a sandboxed publication embed\n\n## Machine surfaces\n\n- [Agent catalog](${publicOrigin}/api/ai): JSON inventory of public surfaces\n- [Homepage markdown](${publicOrigin}/index.md): Product brief without JavaScript\n- [Sitemap](${publicOrigin}/sitemap.xml): Canonical indexed pages\n\n## Current limitation\n\nThe indexed publishing repository is an owner-only pilot. Public moderation and authenticated GitHub rendering are not connected yet.\n`,
    200,
    { "Cache-Control": "public, max-age=3600" },
  ),
);

app.get("/index.md", (c) =>
  c.body(homepageMarkdown, 200, {
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "text/markdown; charset=utf-8",
  }),
);

app.get("/api/ai", (c) =>
  c.json(
    {
      name: "IssuePages",
      version: "1",
      url: publicOrigin,
      llms: `${publicOrigin}/llms.txt`,
      sitemap: `${publicOrigin}/sitemap.xml`,
      robots: `${publicOrigin}/robots.txt`,
      markdown: { suffix: ".md", negotiation: true },
      surfaces: [
        {
          id: "home",
          url: `${publicOrigin}/`,
          md: `${publicOrigin}/index.md`,
          kind: "static",
          description: "Owner-only issue-to-page publishing pilot",
        },
      ],
      auth: {
        public: true,
        notes:
          "Publishing is owner-only; browsing and the universal public-repository reader are public.",
      },
    },
    200,
    { "Cache-Control": "public, max-age=3600" },
  ),
);

app.get("/sitemap.xml", async (c) => {
  const articles = await listArticles(c.env.DB, {
    sort: "updated",
    limit: 1000,
    cursor: null,
    includeArchived: true,
  });
  const staticUrls = ["/", "/pages/newest", "/pages/updated", "/embed"];
  const entries = [
    ...staticUrls.map((path) => ({ loc: `${publicOrigin}${path}`, lastmod: null })),
    ...articles.map((article) => ({
      loc: `${publicOrigin}/articles/${article.issue_number}/${encodeURIComponent(article.slug)}`,
      lastmod: article.last_public_at,
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      ({ loc, lastmod }) =>
        `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ""}</url>`,
    )
    .join("\n")}\n</urlset>\n`;
  return c.body(xml, 200, {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "Content-Type": "application/xml; charset=utf-8",
  });
});

app.get("/", async (c) => {
  const accept = c.req.header("Accept")?.toLowerCase() ?? "";
  if (accept.includes("text/markdown") && !accept.startsWith("text/html")) {
    return c.body(homepageMarkdown, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
    });
  }
  const [newest, updated] = await Promise.all([
    listArticles(c.env.DB, { sort: "newest", limit: 7, cursor: null, includeArchived: true }),
    listArticles(c.env.DB, { sort: "updated", limit: 5, cursor: null, includeArchived: true }),
  ]);
  return html(c, "IssuePages", homePage(siteIdentity(c.env), newest, updated));
});

app.get("/read", (c) => {
  const input = c.req.query("repo") ?? "";
  if (!input) return readerHtml(c, "Read any public repository", readerFormPage());
  const repository = parsePublicRepository(input);
  if (!repository) {
    return readerHtml(
      c,
      "Choose a public repository",
      readerFormPage(
        input.slice(0, 300),
        "Enter owner/repository or a complete https://github.com/owner/repository URL.",
      ),
      { status: 400 },
    );
  }
  return readerHeaders(
    c.redirect(
      `/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
      303,
    ),
  );
});

app.get("/embed", (c) => {
  const input = c.req.query("repo") ?? "";
  const options = embedOptions(c);
  const repository = input ? parsePublicRepository(input) : null;
  const error =
    input && !repository ? "Enter owner/repository or a complete GitHub repository URL." : "";
  return html(
    c,
    "Embed a repository publication",
    embedBuilderPage(input.slice(0, 300), error, repository, options, c.env.PUBLIC_ORIGIN),
  );
});

async function readerRepository(c: Context<AppEnv>): Promise<Response> {
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "reader"))) {
    const response = readerHtml(
      c,
      "Reader paused",
      readerErrorPage(429, "Too many repository reads", "Wait a minute, then try again.", {
        retryHref: c.req.path,
      }),
      { status: 429 },
    );
    response.headers.set("Retry-After", "60");
    return response;
  }
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  if (!repository) {
    return readerHtml(
      c,
      "Repository unavailable",
      readerErrorPage(
        404,
        "Public issues unavailable",
        "That is not a valid public repository path.",
      ),
      { status: 404 },
    );
  }
  const page = decodeReaderCursor(c.req.query("cursor"));
  if (page === null) {
    return readerHtml(
      c,
      "Invalid page",
      readerErrorPage(400, "That page link is invalid", "Return to the repository and try again.", {
        repositoryHref: `/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
      }),
      { status: 400 },
    );
  }
  try {
    const result = await listPublicIssues({
      repository,
      page,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    return readerHtml(c, `${repository.owner}/${repository.repo}`, repositoryReaderPage(result), {
      readerClient: true,
      refreshing: result.refreshing,
      stale: result.stale,
    });
  } catch (error) {
    return readerError(c, error);
  }
}

app.get("/github/:owner/:repo", readerRepository);

async function readerIssue(c: Context<AppEnv>, redirectShort: boolean): Promise<Response> {
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "reader"))) {
    const response = readerHtml(
      c,
      "Reader paused",
      readerErrorPage(429, "Too many repository reads", "Wait a minute, then try again.", {
        retryHref: c.req.path,
      }),
      { status: 429 },
    );
    response.headers.set("Retry-After", "60");
    return response;
  }
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const issueNumber = Number(c.req.param("number"));
  if (!repository || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return readerHtml(
      c,
      "Issue unavailable",
      readerErrorPage(404, "Public issue unavailable", "That is not a valid public issue path."),
      { status: 404 },
    );
  }
  try {
    const result = await getPublicIssue({
      repository,
      issueNumber,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    const canonical = `/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${issueNumber}/${encodeURIComponent(result.issue.slug)}`;
    if (redirectShort || c.req.param("slug") !== result.issue.slug) {
      return readerHeaders(c.redirect(canonical, 308));
    }
    return readerHtml(c, result.issue.title, publicIssueReaderPage(result), {
      mermaid: result.issue.hasMermaid,
      readerClient: true,
      refreshing: result.refreshing,
      stale: result.stale,
    });
  } catch (error) {
    return readerError(c, error);
  }
}

app.get("/github/:owner/:repo/issues/:number", (c) => readerIssue(c, true));

async function readerDiscussion(c: Context<AppEnv>): Promise<Response> {
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "reader-discussion"))) {
    const response = c.body(null, 429, {
      "Cache-Control": "no-store",
      "Retry-After": "60",
    });
    return readerHeaders(response);
  }
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const issueNumber = Number(c.req.param("number"));
  if (!repository || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return readerHeaders(c.body(null, 404, { "Cache-Control": "no-store" }));
  }
  try {
    const result = await getPublicIssueDiscussion({
      repository,
      issueNumber,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    const githubIssueUrl = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${issueNumber}`;
    const response = c.html(publicDiscussionFragment(result, githubIssueUrl), 200, {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400",
    });
    return readerHeaders(
      response,
      result.stale ? "STALE" : result.refreshing ? "REFRESHING" : "FRESH",
    );
  } catch (error) {
    if (error instanceof GitHubReaderError) {
      const status = error.code === "not_found" ? 404 : 503;
      const response = c.body(null, status, {
        "Cache-Control": "no-store",
        ...(status === 503 ? { "Retry-After": "60" } : {}),
      });
      return readerHeaders(response);
    }
    throw error;
  }
}

app.get("/github/:owner/:repo/issues/:number/discussion", readerDiscussion);
app.get("/github/:owner/:repo/issues/:number/:slug", (c) => readerIssue(c, false));

function embedHtml(
  c: Context<AppEnv>,
  title: string,
  repository: PublicRepository | null,
  body: string,
  options: EmbedOptions,
  responseOptions: {
    status?: 200 | 400 | 404 | 429 | 503;
    mermaid?: boolean;
    refreshing?: boolean;
    stale?: boolean;
  } = {},
): Response {
  const status = responseOptions.status ?? 200;
  const response = c.html(
    embedLayout(title, repository, body, options, responseOptions.mermaid),
    status,
    {
      "Cache-Control":
        status === 200
          ? "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400"
          : "no-store",
    },
  );
  return readerHeaders(
    response,
    status === 200
      ? responseOptions.stale
        ? "STALE"
        : responseOptions.refreshing
          ? "REFRESHING"
          : "FRESH"
      : undefined,
  );
}

function embedOptions(c: Context<AppEnv>): EmbedOptions {
  return parseEmbedOptions((name) => c.req.query(name));
}

function embedFailure(
  c: Context<AppEnv>,
  error: unknown,
  repository: PublicRepository | null,
  options: EmbedOptions,
): Response {
  if (!(error instanceof GitHubReaderError)) throw error;
  if (error.code === "not_found") {
    return embedHtml(
      c,
      "Repository unavailable",
      repository,
      embedErrorPage(
        404,
        "Public issues unavailable",
        "The repository or issue may be missing, private, or have issues disabled.",
      ),
      options,
      { status: 404 },
    );
  }
  const requestUrl = new URL(c.req.url);
  const response = embedHtml(
    c,
    "GitHub temporarily unavailable",
    repository,
    embedErrorPage(
      503,
      "GitHub could not answer",
      error.code === "rate_limited"
        ? "The shared GitHub allowance is exhausted. Wait a minute and try again."
        : "This publication could not refresh from GitHub. Try again shortly.",
      `${requestUrl.pathname}${requestUrl.search}`,
    ),
    options,
    { status: 503 },
  );
  response.headers.set("Retry-After", "60");
  return response;
}

async function embedRepository(c: Context<AppEnv>): Promise<Response> {
  const options = embedOptions(c);
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  if (!repository) {
    return embedHtml(
      c,
      "Repository unavailable",
      null,
      embedErrorPage(404, "Public issues unavailable", "That is not a valid repository path."),
      options,
      { status: 404 },
    );
  }
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "embed"))) {
    const response = embedHtml(
      c,
      "Publication paused",
      repository,
      embedErrorPage(
        429,
        "Too many repository reads",
        "Wait a minute, then try again.",
        c.req.path,
      ),
      options,
      { status: 429 },
    );
    response.headers.set("Retry-After", "60");
    return response;
  }
  const rawCursor = c.req.query("cursor");
  const page = decodeReaderCursor(rawCursor);
  if (page === null) {
    return embedHtml(
      c,
      "Invalid page",
      repository,
      embedErrorPage(
        400,
        "That page link is invalid",
        "Return to the repository and try again.",
        `${c.req.path}?${embedQuery(options)}`,
      ),
      options,
      { status: 400 },
    );
  }
  try {
    const result = await listPublicIssues({
      repository,
      page,
      ...(options.label ? { label: options.label } : {}),
      ...(options.author ? { author: options.author } : {}),
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    return embedHtml(
      c,
      `${repository.owner}/${repository.repo}`,
      repository,
      embedRepositoryPage(result, options, rawCursor ?? null),
      options,
      { refreshing: result.refreshing, stale: result.stale },
    );
  } catch (error) {
    return embedFailure(c, error, repository, options);
  }
}

app.get("/embed/:owner/:repo", embedRepository);

async function embedIssue(c: Context<AppEnv>, redirectShort: boolean): Promise<Response> {
  const options = embedOptions(c);
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const issueNumber = Number(c.req.param("number"));
  if (!repository || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return embedHtml(
      c,
      "Issue unavailable",
      repository,
      embedErrorPage(404, "Public issue unavailable", "That is not a valid public issue path."),
      options,
      { status: 404 },
    );
  }
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "embed"))) {
    const response = embedHtml(
      c,
      "Publication paused",
      repository,
      embedErrorPage(
        429,
        "Too many repository reads",
        "Wait a minute, then try again.",
        c.req.path,
      ),
      options,
      { status: 429 },
    );
    response.headers.set("Retry-After", "60");
    return response;
  }
  const rawBack = c.req.query("back");
  const backCursor = rawBack && decodeReaderCursor(rawBack) !== null ? rawBack : null;
  try {
    const result = await getPublicIssue({
      repository,
      issueNumber,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    if (!issueMatchesEmbedFilters(result.issue, options)) {
      const repositoryUrl = `/embed/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}?${embedQuery(options, { cursor: backCursor })}`;
      return embedHtml(
        c,
        "Issue outside this publication",
        repository,
        embedErrorPage(
          404,
          "Issue not in this publication",
          "This issue does not match the author or label filters for this embedded publication.",
          repositoryUrl,
        ),
        options,
        { status: 404 },
      );
    }
    const canonical = `/embed/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${issueNumber}/${encodeURIComponent(result.issue.slug)}?${embedQuery(options, { back: backCursor })}`;
    if (redirectShort || c.req.param("slug") !== result.issue.slug) {
      return readerHeaders(c.redirect(canonical, 308));
    }
    return embedHtml(
      c,
      result.issue.title,
      repository,
      embedIssuePage(result, options, backCursor),
      options,
      {
        mermaid: result.issue.hasMermaid,
        refreshing: result.refreshing,
        stale: result.stale,
      },
    );
  } catch (error) {
    return embedFailure(c, error, repository, options);
  }
}

app.get("/embed/:owner/:repo/issues/:number", (c) => embedIssue(c, true));

async function embedDiscussion(c: Context<AppEnv>): Promise<Response> {
  const options = embedOptions(c);
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "embed-discussion"))) {
    return readerHeaders(c.body(null, 429, { "Cache-Control": "no-store", "Retry-After": "60" }));
  }
  const repository = parsePublicRepository(`${c.req.param("owner")}/${c.req.param("repo")}`);
  const issueNumber = Number(c.req.param("number"));
  if (!repository || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return readerHeaders(c.body(null, 404, { "Cache-Control": "no-store" }));
  }
  try {
    const issue = await getPublicIssue({
      repository,
      issueNumber,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    if (!issueMatchesEmbedFilters(issue.issue, options)) {
      return readerHeaders(c.body(null, 404, { "Cache-Control": "no-store" }));
    }
    const result = await getPublicIssueDiscussion({
      repository,
      issueNumber,
      origin: c.env.PUBLIC_ORIGIN,
      ctx: c.executionCtx,
    });
    const githubIssueUrl = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${issueNumber}`;
    return readerHeaders(
      c.html(embedDiscussionFragment(result, githubIssueUrl), 200, {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400",
      }),
      result.stale ? "STALE" : result.refreshing ? "REFRESHING" : "FRESH",
    );
  } catch (error) {
    if (error instanceof GitHubReaderError) {
      const status = error.code === "not_found" ? 404 : 503;
      return readerHeaders(
        c.body(null, status, {
          "Cache-Control": "no-store",
          ...(status === 503 ? { "Retry-After": "60" } : {}),
        }),
      );
    }
    throw error;
  }
}

app.get("/embed/:owner/:repo/issues/:number/discussion", embedDiscussion);
app.get("/embed/:owner/:repo/issues/:number/:slug", (c) => embedIssue(c, false));

async function renderListing(c: Context<AppEnv>, sort: "newest" | "updated"): Promise<Response> {
  const rawCursor = c.req.query("cursor");
  const cursor = parsePageCursor(rawCursor, "string");
  if (rawCursor && !cursor) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Invalid cursor",
        errorPage(
          400,
          "That page link is invalid",
          "Return to the beginning of this list and try again.",
        ),
      ),
      400,
    );
  }
  const rows = await listArticles(c.env.DB, {
    sort,
    limit: pageSize + 1,
    cursor,
    includeArchived: true,
  });
  const result = nextCursor(rows, sort);
  const path = sort === "newest" ? "/pages/newest" : "/pages/updated";
  const heading = sort === "newest" ? "Newest pages" : "Recently updated";
  const intro =
    sort === "newest"
      ? "Public pages in the order their GitHub issues were opened."
      : "Public pages ordered by their latest safe issue, comment, or reaction update.";
  return html(
    c,
    heading,
    listingPage(
      heading,
      intro,
      result.page,
      appendCursor(path, result.cursor),
      sort === "newest" ? "published_at" : "last_public_at",
    ),
  );
}

app.get("/pages/newest", (c) => renderListing(c, "newest"));
app.get("/pages/updated", (c) => renderListing(c, "updated"));

app.get("/articles/:number", async (c) => {
  const issueNumber = Number(c.req.param("number"));
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Page not found",
        errorPage(404, "Page not found", "Issue numbers are positive whole numbers."),
      ),
      404,
    );
  }
  const article = await getArticleByIssueNumber(c.env.DB, issueNumber);
  if (!article) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Page not found",
        errorPage(
          404,
          "No public page here",
          "The issue may be unpublished, reserved for project work, or missing.",
        ),
      ),
      404,
    );
  }
  return c.redirect(`/articles/${article.issue_number}/${encodeURIComponent(article.slug)}`, 308);
});

app.get("/articles/:number/:slug", async (c) => {
  const issueNumber = Number(c.req.param("number"));
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Page not found",
        errorPage(404, "Page not found", "This is not a valid public issue number."),
      ),
      404,
    );
  }
  const article = await getArticleByIssueNumber(c.env.DB, issueNumber);
  if (!article) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Page not found",
        errorPage(
          404,
          "No public page here",
          "The issue may be unpublished, reserved for project work, or missing.",
        ),
      ),
      404,
    );
  }
  if (c.req.param("slug") !== article.slug) {
    return c.redirect(`/articles/${article.issue_number}/${encodeURIComponent(article.slug)}`, 308);
  }

  const key = articleCacheKey(c.env.PUBLIC_ORIGIN, article.issue_number, article.public_revision);
  const cached = await caches.default.match(key);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-IssuePages-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const comments = await getComments(c.env.DB, article.issue_id);
  const hasMermaid =
    article.body_html.includes("data-mermaid") ||
    comments.some((comment) => comment.body_html.includes("data-mermaid"));
  const body = layout(siteIdentity(c.env), article.title, articlePage(article, comments), {
    description: article.excerpt,
    mermaid: hasMermaid,
    polling: true,
  });
  const response = c.html(body, 200, {
    "Cache-Control": "public, max-age=0, s-maxage=86400",
    ETag: `"article-${article.issue_number}-${article.public_revision}"`,
    "X-IssuePages-Cache": "MISS",
  });
  c.executionCtx.waitUntil(caches.default.put(key, response.clone()));
  return response;
});

app.get("/api/articles/:number/version", async (c) => {
  if (!(await withinRateLimit(c.env.VERSION_RATE_LIMIT, c.req.raw, "version"))) {
    return c.json({ error: "rate_limited" }, 429, {
      "Cache-Control": "no-store",
      "Retry-After": "60",
    });
  }
  const issueNumber = Number(c.req.param("number"));
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return c.json({ error: "not_found" }, 404, { "Cache-Control": "no-store" });
  }
  const article = await getArticleByIssueNumber(c.env.DB, issueNumber);
  if (!article) return c.json({ error: "not_found" }, 404, { "Cache-Control": "no-store" });
  return c.json(
    {
      issue: article.issue_number,
      revision: article.public_revision,
      updatedAt: article.last_public_at,
    },
    200,
    { "Cache-Control": "no-store" },
  );
});

app.get("/authors/:login", async (c) => {
  const login = c.req.param("login");
  const author = await getAuthor(c.env.DB, login);
  if (!author) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Author not found",
        errorPage(404, "Author not found", "No public pages belong to that GitHub author."),
      ),
      404,
    );
  }
  const rawCursor = c.req.query("cursor");
  const cursor = parsePageCursor(rawCursor, "string");
  if (rawCursor && !cursor) return c.text("Invalid cursor", 400);
  const rows = await listArticles(c.env.DB, {
    sort: "newest",
    limit: pageSize + 1,
    cursor,
    author: author.login,
    includeArchived: true,
  });
  const result = nextCursor(rows, "newest");
  const next = appendCursor(`/authors/${encodeURIComponent(author.login)}`, result.cursor);
  return html(
    c,
    `@${author.login}`,
    listingPage(
      `@${author.login}`,
      `Public pages opened by ${author.login}.`,
      result.page,
      next,
      "published_at",
      authorIntro(author),
    ),
  );
});

app.get("/labels/:slug", async (c) => {
  const label = await getLabel(c.env.DB, c.req.param("slug"));
  if (!label) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Label not found",
        errorPage(404, "Label not found", "No public pages currently use that label."),
      ),
      404,
    );
  }
  const rawCursor = c.req.query("cursor");
  const cursor = parsePageCursor(rawCursor, "string");
  if (rawCursor && !cursor) return c.text("Invalid cursor", 400);
  const rows = await listArticles(c.env.DB, {
    sort: "newest",
    limit: pageSize + 1,
    cursor,
    label: label.slug,
    includeArchived: true,
  });
  const result = nextCursor(rows, "newest");
  const next = appendCursor(`/labels/${encodeURIComponent(label.slug)}`, result.cursor);
  return html(
    c,
    label.name,
    listingPage(
      label.name,
      label.description ?? `Public pages carrying the ${label.name} GitHub label.`,
      result.page,
      next,
    ),
  );
});

app.get("/search", async (c) => {
  if (!(await withinRateLimit(c.env.SEARCH_RATE_LIMIT, c.req.raw, "search"))) {
    return c.html(
      layout(
        siteIdentity(c.env),
        "Search paused",
        errorPage(429, "Too many searches", "Wait a minute, then try again."),
      ),
      429,
      { "Retry-After": "60" },
    );
  }
  const query = (c.req.query("q") ?? "").normalize("NFKC").trim().slice(0, 200);
  const rawCursor = c.req.query("cursor");
  const cursor = parsePageCursor(rawCursor, "number");
  if (rawCursor && !cursor) return c.text("Invalid cursor", 400);
  const rows = query ? await searchArticles(c.env.DB, query, pageSize + 1, cursor) : [];
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  const next =
    rows.length > pageSize && last
      ? appendCursor("/search", encodeCursor(last.rank, last.issue_id), query)
      : null;
  return html(c, query ? `Search: ${query}` : "Search", searchPage(query, page, next));
});

app.get("/random", async (c) => {
  const article = await getRandomArticle(c.env.DB);
  if (!article) return c.redirect("/", 302);
  return c.redirect(`/articles/${article.issue_number}/${encodeURIComponent(article.slug)}`, 302);
});

app.post("/webhooks/github", handleGitHubWebhook);
app.get("/admin/moderation", listModerationQueue);
app.post("/admin/moderation/:id/approve", (c) => decideModeration(c, "approved"));
app.post("/admin/moderation/:id/reject", (c) => decideModeration(c, "rejected"));

app.notFound((c) =>
  c.html(
    layout(
      siteIdentity(c.env),
      "Page not found",
      errorPage(404, "Page not found", "That route is not part of the public repository."),
      { footerPromotion: false },
    ),
    404,
  ),
);

app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ event: "request_failed", requestId, error: error.message }));
  return c.html(
    layout(
      siteIdentity(c.env),
      "Something went wrong",
      errorPage(
        500,
        "Something went wrong",
        `The request could not be completed. Reference: ${requestId}`,
      ),
      { footerPromotion: false },
    ),
    500,
    { "Cache-Control": "no-store" },
  );
});

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<AppBindings>;
