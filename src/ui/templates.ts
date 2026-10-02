import type { SearchRow } from "../data/repository";
import type { EmbedOptions } from "../lib/embed";
import type {
  PublicComment,
  PublicIssueDiscussion,
  PublicIssueList,
  PublicIssuePage,
  PublicIssueSummary,
  PublicRepository,
} from "../lib/github-reader";
import { safeJson } from "../lib/html";
import type { ArticleListRow, ArticleRow, CommentRow, GitHubUser, ModerationMode } from "../types";

export interface SiteIdentity {
  owner: string;
  repo: string;
  moderationMode: ModerationMode;
}

interface LabelView {
  name: string;
  slug: string;
  color: string;
}

const reactionNames: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function datetime(value: string): string {
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(formatDate(value))}</time>`;
}

function parseLabels(value: string | null): LabelView[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (label): label is LabelView =>
        typeof label === "object" &&
        label !== null &&
        typeof label.name === "string" &&
        typeof label.slug === "string" &&
        typeof label.color === "string",
    );
  } catch {
    return [];
  }
}

function parseReactions(value: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => {
        return typeof entry[1] === "number" && entry[1] > 0;
      }),
    );
  } catch {
    return {};
  }
}

function articleHref(article: Pick<ArticleListRow, "issue_number" | "slug">): string {
  return `/articles/${article.issue_number}/${encodeURIComponent(article.slug)}`;
}

function publishHref(site: SiteIdentity): string {
  return `https://github.com/${encodeURIComponent(site.owner)}/${encodeURIComponent(site.repo)}/issues/new?template=publish.md`;
}

function repoHref(site: SiteIdentity): string {
  return `https://github.com/${encodeURIComponent(site.owner)}/${encodeURIComponent(site.repo)}`;
}

const githubIcon =
  '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>';

function header(site: SiteIdentity): string {
  return `<header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/" aria-label="IssuePages home">IssuePages</a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a class="nav-link" href="/search">Search</a>
        <a class="nav-link nav-link--primary" href="${publishHref(site)}" rel="external">Publish</a>
      </nav>
    </div>
  </header>`;
}

function footer(site: SiteIdentity): string {
  return `<footer class="site-footer">
    <div class="site-footer__inner">
      <span>IssuePages is a readable view of a GitHub repository.</span>
      <a href="${repoHref(site)}" rel="external noopener noreferrer" target="_blank" aria-label="GitHub repository" title="GitHub repository">${githubIcon}</a>
    </div>
  </footer>`;
}

export function layout(
  site: SiteIdentity,
  title: string,
  body: string,
  options: {
    canonicalPath?: string;
    description?: string;
    mermaid?: boolean;
    polling?: boolean;
    reader?: boolean;
    readerClient?: boolean;
    robots?: boolean;
    footerPromotion?: boolean;
  } = {},
): string {
  const pageTitle = title === "IssuePages" ? title : `${title} · IssuePages`;
  const description =
    options.description ?? "Open a GitHub issue and leave a public page on the internet.";
  const canonical = options.canonicalPath
    ? new URL(options.canonicalPath, "https://issues.sarthakagrawal.dev").toString()
    : null;
  const socialImage =
    "https://opengraph.githubassets.com/issue-pages/sarthakagrawal927/issue-pages";
  const schema = {
    "@context": "https://schema.org",
    "@type": title === "IssuePages" ? "WebSite" : "WebPage",
    name: pageTitle,
    description,
    ...(canonical ? { url: canonical } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: "IssuePages",
      url: "https://issues.sarthakagrawal.dev/",
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  ${options.robots ? '<meta name="robots" content="noindex,nofollow,noarchive">' : ""}
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#fbfbfa">
  <title>${escapeHtml(pageTitle)}</title>
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  ${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ""}
  <meta property="og:site_name" content="IssuePages">
  <meta property="og:image" content="${socialImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${socialImage}">
  <script type="application/ld+json">${safeJson(schema)}</script>
  <link rel="stylesheet" href="/styles.css?v=20260826-10">
  ${options.polling ? '<script src="/article-poll.js?v=20260825-5" defer></script>' : ""}
  ${options.readerClient ? '<script type="module" src="/assets/reader.js?v=20260826-3"></script>' : ""}
  ${options.mermaid ? '<script type="module" src="/assets/mermaid.js?v=20260825-2"></script>' : ""}
  <script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","ybch2c99wz");window.clarity("set","project_id","issue-pages");</script>
  <script src="/app-health-log.js" defer></script>
  <script src="https://health.sassmaker.com/tracker.js" data-key="ahk_pub_360a0c19017b6745e5442b17d3e6bc2d9cf2f3e2589b5b3a6fb252354bfdcd77" data-project="app-import-783e7446c5372a124641919fba6f29496840ef28f5cf0d11f85330069a3c51e2" data-identity="persistent" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header(site)}
  <main id="main">${body}</main>
  ${footer(site)}
  ${
    options.footerPromotion === false
      ? ""
      : `<saas-maker-newsletter-capture product-name="IssuePages" catalog-id="issue-pages" kind="newsletter" source="footer" privacy-url="https://sassmaker.com/privacy"></saas-maker-newsletter-capture>
  <script type="module" src="https://sassmaker.com/newsletter-capture.js"></script>
  <script src="https://sassmaker.com/project-strip.js" data-project="issue-pages" defer></script>
  <script src="https://sassmaker.com/ai-chat-footer.js" data-name="IssuePages" defer></script>`
  }
</body>
</html>`;
}

function pageStrip(article: ArticleListRow, dateField: "published_at" | "last_public_at"): string {
  const label = dateField === "published_at" ? "Published" : "Updated";
  return `<article class="page-strip">
    <a class="page-strip__number" href="${articleHref(article)}" aria-label="Open issue ${article.issue_number}">#${article.issue_number}</a>
    <div class="page-strip__body">
      <a class="page-strip__title" href="${articleHref(article)}">${escapeHtml(article.title)}</a>
      <span class="page-strip__meta">by <a href="/authors/${encodeURIComponent(article.author_login)}">@${escapeHtml(article.author_login)}</a> · ${article.comment_count} ${article.comment_count === 1 ? "reply" : "replies"}</span>
    </div>
    <span class="page-strip__date"><span>${label}</span>${datetime(article[dateField])}</span>
  </article>`;
}

export function homePage(
  site: SiteIdentity,
  newest: ArticleListRow[],
  updated: ArticleListRow[],
): string {
  const ownerOnly = site.moderationMode === "owner-only";
  const newestIds = new Set(newest.slice(0, 5).map((article) => article.issue_number));
  const distinctUpdates = updated.filter((article) => !newestIds.has(article.issue_number));
  const newestList = newest.length
    ? newest
        .slice(0, 5)
        .map((article) => pageStrip(article, "published_at"))
        .join("")
    : '<div class="empty-state">No public pages yet.</div>';
  const updatedList = distinctUpdates.length
    ? distinctUpdates
        .slice(0, 5)
        .map((article) => pageStrip(article, "last_public_at"))
        .join("")
    : "";

  return `<section class="hero" aria-labelledby="home-title">
    <p class="field-note">This website is a GitHub repository.</p>
    <h1 id="home-title">Open an issue and leave your page on the internet.</h1>
    <p class="hero-copy">Write in Markdown. The issue becomes a public page, and its edits and discussion stay connected to GitHub.</p>
    <div class="hero-actions"><a class="button" href="${publishHref(site)}" rel="external" data-app-health-event="publish_started">${ownerOnly ? "Open a pilot issue" : "Publish something"} <span aria-hidden="true">↗</span></a><a class="text-link" href="${repoHref(site)}" rel="external noopener noreferrer" target="_blank" aria-label="GitHub repository" title="GitHub repository">${githubIcon}</a></div>
    ${
      ownerOnly
        ? `<p class="pilot-notice"><strong>Owner-only pilot.</strong> Your GitHub issue is public immediately. Pages from @${escapeHtml(site.owner)} appear here automatically; everyone else waits here for review until public moderation is connected.</p>`
        : '<p class="publish-trust">Your GitHub issue is public immediately. IssuePages publishes it after automated safety checks; anything held waits here for review.</p>'
    }
  </section>
  <section class="section" aria-labelledby="newest-title">
    <div class="section-head"><h2 id="newest-title">Newest pages</h2><a class="text-link" href="/pages/newest">Browse all</a></div>
    <div class="listing">${newestList}</div>
  </section>
  <section class="reader-callout" aria-labelledby="reader-callout-title">
    <div><h2 id="reader-callout-title">Read any public repository</h2><p>Turn its issues into a quiet, read-only publication.</p></div>
    <div class="reader-callout__actions"><a class="text-link" href="/read" data-app-health-event="repository_reader_opened">Open a repository →</a><a class="text-link" href="/embed" data-app-health-event="embed_builder_opened">Embed one →</a></div>
  </section>
  ${
    updatedList
      ? `<section class="section" aria-labelledby="updated-title">
    <div class="section-head"><h2 id="updated-title">Recently updated</h2><a class="text-link" href="/pages/updated">Browse updates</a></div>
    <div class="listing">${updatedList}</div>
  </section>`
      : ""
  }`;
}

function labelLinks(labelsJson: string | null): string {
  const labels = parseLabels(labelsJson);
  if (labels.length === 0) return "";
  return `<div class="tags" aria-label="Labels">${labels
    .map(
      (label) =>
        `<a class="tag" href="/labels/${encodeURIComponent(label.slug)}">${escapeHtml(label.name)}</a>`,
    )
    .join("")}</div>`;
}

function reactionList(value: string, accessiblePrefix: string, sourceHref: string): string {
  const entries = Object.entries(parseReactions(value));
  if (entries.length === 0) return "";
  return `<div class="reactions" aria-label="${escapeHtml(accessiblePrefix)} reactions"><a class="reactions__label" href="${escapeHtml(sourceHref)}" rel="external">Reactions on GitHub ↗</a>${entries
    .map(
      ([name, count]) =>
        `<span class="reaction"><span aria-hidden="true">${reactionNames[name] ?? "•"}</span> <span class="sr-only">${escapeHtml(name)}</span>${count}</span>`,
    )
    .join("")}</div>`;
}

function commentView(comment: CommentRow): string {
  const avatar = safeHttpsUrl(comment.author_avatar_url);
  return `<article class="comment" id="comment-${comment.github_id}">
    ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" width="48" height="48" loading="lazy" alt="">` : '<span class="avatar" aria-hidden="true"></span>'}
    <div>
      <div class="comment__meta"><a href="/authors/${encodeURIComponent(comment.author_login)}">@${escapeHtml(comment.author_login)}</a> · ${datetime(comment.github_created_at)} · <a href="${escapeHtml(comment.github_url)}" rel="external">source ↗</a></div>
      <div class="prose">${comment.body_html}</div>
      ${reactionList(comment.reactions_json, `Comment by ${comment.author_login}`, comment.github_url)}
    </div>
  </article>`;
}

export function articlePage(article: ArticleRow, comments: CommentRow[]): string {
  const archived = article.state === "closed";
  const discussion = comments.length
    ? comments.map(commentView).join("")
    : '<div class="empty-state">No public replies yet. Discussion stays on the original GitHub issue.</div>';
  return `<div class="page-shell" data-article-issue="${article.issue_number}" data-article-version="${article.public_revision}">
    <aside class="page-rail" aria-label="Page details">
      <p class="eyebrow">Issue #${article.issue_number}</p>
      <h1>${escapeHtml(article.title)}</h1>
      ${labelLinks(article.labels)}
      <dl>
        <dt>Author</dt><dd><a href="/authors/${encodeURIComponent(article.author_login)}">@${escapeHtml(article.author_login)}</a></dd>
        <dt>Published</dt><dd>${datetime(article.published_at)}</dd>
        <dt>Last edited</dt><dd>${datetime(article.github_updated_at)}</dd>
        <dt>Status</dt><dd>${archived ? "Archived" : "Published"}</dd>
      </dl>
      <a class="button button--light" href="${escapeHtml(article.github_url)}" rel="external">Open on GitHub <span aria-hidden="true">↗</span></a>
    </aside>
    <article class="article-pane">
      ${archived ? '<div class="archive-notice"><strong>Archived page.</strong> The source issue is closed; this page remains available as a record.</div>' : ""}
      <div class="prose">${article.body_html}</div>
      ${reactionList(article.reactions_json, "Article", article.github_url)}
      <section class="discussion" aria-labelledby="discussion-title">
        <h2 id="discussion-title">Discussion <span>${comments.length}</span></h2>
        ${discussion}
      </section>
      <nav class="onward" aria-label="Keep reading">
        <h2>Keep reading</h2>
        <a href="/authors/${encodeURIComponent(article.author_login)}">More by @${escapeHtml(article.author_login)}</a>
        <a href="/random">Open a random page</a>
        <a href="/">Return to live pages</a>
      </nav>
    </article>
  </div>`;
}

function listingItems(
  articles: ArticleListRow[],
  dateField: "published_at" | "last_public_at",
): string {
  if (articles.length === 0)
    return '<div class="empty-state">Nothing public matches this view yet.</div>';
  return articles.map((article) => pageStrip(article, dateField)).join("");
}

export function listingPage(
  heading: string,
  intro: string,
  articles: ArticleListRow[],
  nextHref: string | null,
  dateField: "published_at" | "last_public_at" = "published_at",
  extra = "",
): string {
  return `<div class="listing-shell">
    ${extra}
    <h1 class="listing-title">${escapeHtml(heading)}</h1>
    <p class="listing-intro">${escapeHtml(intro)}</p>
    <div class="listing">${listingItems(articles, dateField)}</div>
    ${nextHref ? `<nav class="pagination" aria-label="Pagination"><a class="button button--light" href="${escapeHtml(nextHref)}">Older pages →</a></nav>` : ""}
  </div>`;
}

function highlightedSnippet(value: string): string {
  return escapeHtml(value).replaceAll("\u0001", "<mark>").replaceAll("\u0002", "</mark>");
}

export function searchPage(query: string, rows: SearchRow[], nextHref: string | null): string {
  const results = !query
    ? '<div class="empty-state">Search titles, page content, authors, labels, and public comments.</div>'
    : rows.length
      ? rows
          .map(
            (row) => `<article class="result">
              <h2><a href="${articleHref(row)}">${escapeHtml(row.title)}</a></h2>
              <p class="page-strip__meta">Issue #${row.issue_number} · @${escapeHtml(row.author_login)} · ${datetime(row.published_at)}</p>
              <p>${highlightedSnippet(row.snippet || row.excerpt)}</p>
            </article>`,
          )
          .join("")
      : '<div class="empty-state"><strong>No matching pages.</strong><br>Try fewer or more general words.</div>';
  return `<div class="listing-shell">
    <h1 class="listing-title">Search</h1>
    <form class="search-form" role="search" action="/search" method="get">
      <label class="sr-only" for="search-query">Search all public content</label>
      <input id="search-query" name="q" type="search" value="${escapeHtml(query)}" placeholder="Words, authors, or labels">
      <button type="submit">Search</button>
    </form>
    <div aria-live="polite">${results}</div>
    ${nextHref ? `<nav class="pagination" aria-label="Pagination"><a class="button button--light" href="${escapeHtml(nextHref)}">More results →</a></nav>` : ""}
  </div>`;
}

export function authorIntro(author: GitHubUser): string {
  const avatar = safeHttpsUrl(author.avatar_url);
  return `<div class="identity-strip">
    ${avatar ? `<img class="avatar avatar--large" src="${escapeHtml(avatar)}" width="72" height="72" alt="">` : ""}
    <div><p class="eyebrow">GitHub author</p><a href="${escapeHtml(author.html_url)}" rel="external">View @${escapeHtml(author.login)} on GitHub ↗</a></div>
  </div>`;
}

export function errorPage(code: number, heading: string, detail: string): string {
  return `<div class="listing-shell">
    <div class="error-code" aria-hidden="true">${code}</div>
    <h1 class="listing-title">${escapeHtml(heading)}</h1>
    <p class="listing-intro">${escapeHtml(detail)}</p>
    <p><a class="button button--light" href="/">Return to live pages →</a></p>
  </div>`;
}

function readerRepositoryHref(repository: PublicRepository, cursor?: string | null): string {
  const path = `/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

function readerIssueHref(repository: PublicRepository, issue: PublicIssueSummary): string {
  return `${readerRepositoryHref(repository)}/issues/${issue.number}/${encodeURIComponent(issue.slug)}`;
}

function freshnessNotice(stale: boolean, cachedAt: string): string {
  if (!stale) return "";
  return `<div class="reader-notice reader-notice--stale" role="status"><strong>Showing the last safe copy.</strong> GitHub could not refresh this page. Data is from ${datetime(cachedAt)}.</div>`;
}

export function readerFormPage(value = "", error = ""): string {
  return `<div class="reader-shell">
    <div class="reader-intro">
      <p class="eyebrow">Universal reader</p>
      <h1>Turn public issues into a reading view.</h1>
      <p>Paste a public GitHub repository URL or <strong>owner/repository</strong>. Nothing is installed, copied into the publishing database, or added to this site’s feeds.</p>
    </div>
    <form class="repo-form" action="/read" method="get">
      <label for="repository">Public GitHub repository</label>
      <div class="repo-form__control">
        <input id="repository" name="repo" value="${escapeHtml(value)}" placeholder="github.com/owner/repository" autocomplete="url" spellcheck="false" aria-describedby="repository-help${error ? " repository-error" : ""}"${error ? ' aria-invalid="true" autofocus' : ""}>
        <button type="submit">Read issues →</button>
      </div>
      <p id="repository-help">Public issues only. GitHub remains the source for editing, reacting, and commenting.</p>
      ${error ? `<p id="repository-error" class="field-error" role="alert">${escapeHtml(error)}</p>` : ""}
    </form>
    <div class="reader-boundary">
      <strong>Two modes, one website.</strong>
      <span>Your IssuePages repository is the moderated publishing experiment. Other repositories are uncatalogued, read-through views and are not indexed by search engines.</span>
    </div>
  </div>`;
}

export function embedBuilderPage(
  value: string,
  error: string,
  repository: PublicRepository | null,
  options: EmbedOptions,
  origin: string,
): string {
  const repoName = repository ? `${repository.owner}/${repository.repo}` : "owner/repository";
  const accentAttribute = options.accent === "#9d2f2a" ? "" : `\n  data-accent="${options.accent}"`;
  const labelAttribute = options.label ? `\n  data-label="${options.label}"` : "";
  const authorAttribute = options.author ? `\n  data-author="${options.author}"` : "";
  const variantAttribute = options.variant === "minimal" ? `\n  data-variant="minimal"` : "";
  const snippet = `<script\n  async\n  src="${origin}/embed.js?v=20260826-2"\n  data-repo="${repoName}"\n  data-theme="${options.theme}"\n  data-density="${options.density}"${variantAttribute}${accentAttribute}${labelAttribute}${authorAttribute}\n></script>`;
  return `<div class="embed-builder">
    <section class="embed-builder__intro">
      <p class="eyebrow">Embeddable publication</p>
      <h1>Paste one script. Get the whole repository.</h1>
      <p>Issue index, cursor pagination, full issue bodies, labels, reactions, archive state, and deferred discussion—responsive and read-only.</p>
    </section>
    <form class="embed-config repo-form" action="/embed" method="get">
      <label for="embed-repository">Public GitHub repository</label>
      <input id="embed-repository" name="repo" value="${escapeHtml(value)}" placeholder="owner/repository" spellcheck="false" required${error ? ' aria-invalid="true" aria-describedby="embed-repository-error" autofocus' : ""}>
      <div class="embed-config__options">
        <label>Theme<select name="theme"><option value="auto"${options.theme === "auto" ? " selected" : ""}>Auto</option><option value="inherit"${options.theme === "inherit" ? " selected" : ""}>Inherit host</option><option value="light"${options.theme === "light" ? " selected" : ""}>Light</option><option value="dark"${options.theme === "dark" ? " selected" : ""}>Dark</option></select></label>
        <label>Density<select name="density"><option value="comfortable"${options.density === "comfortable" ? " selected" : ""}>Comfortable</option><option value="compact"${options.density === "compact" ? " selected" : ""}>Compact</option></select></label>
        <label>Accent<input name="accent" type="color" value="${options.accent}"></label>
      </div>
      <label for="embed-variant">Frame style</label>
      <select id="embed-variant" name="variant"><option value="folio"${options.variant === "folio" ? " selected" : ""}>Issue folio</option><option value="minimal"${options.variant === "minimal" ? " selected" : ""}>Minimal host-neutral</option></select>
      <label for="embed-label">Only issues with this label <span>(optional)</span></label>
      <input id="embed-label" name="label" value="${escapeHtml(options.label)}" placeholder="blog" maxlength="50">
      <label for="embed-author">Only issues by this GitHub author <span>(optional)</span></label>
      <input id="embed-author" name="author" value="${escapeHtml(options.author)}" placeholder="octocat" maxlength="39" spellcheck="false">
      ${error ? `<p id="embed-repository-error" class="field-error" role="alert">${escapeHtml(error)}</p>` : ""}
      <button type="submit">Build embed →</button>
    </form>
    <section class="embed-code" aria-labelledby="embed-code-title">
      <div><p class="eyebrow">Install</p><h2 id="embed-code-title">Copy into your page</h2></div>
      <pre><code>${escapeHtml(snippet)}</code></pre>
      <p>Style the width and surrounding spacing on your site. The publication inside stays isolated and automatically resizes.</p>
    </section>
    ${
      repository
        ? `<section class="embed-preview" aria-labelledby="embed-preview-title"><p class="eyebrow">Live preview</p><h2 id="embed-preview-title">${escapeHtml(repoName)}</h2><script async src="/embed.js?v=20260826-2" data-repo="${escapeHtml(repoName)}" data-theme="${options.theme}" data-density="${options.density}" data-variant="${options.variant}" data-accent="${options.accent}"${options.label ? ` data-label="${escapeHtml(options.label)}"` : ""}${options.author ? ` data-author="${escapeHtml(options.author)}"` : ""}></script></section>`
        : ""
    }
  </div>`;
}

function publicIssueStrip(repository: PublicRepository, issue: PublicIssueSummary): string {
  const href = readerIssueHref(repository, issue);
  const authorUrl = safeHttpsUrl(issue.author.githubUrl) ?? "https://github.com";
  return `<article class="page-strip reader-strip">
    <a class="page-strip__number" href="${href}" aria-label="Read issue ${issue.number}">#${issue.number}</a>
    <div class="page-strip__body">
      <a class="page-strip__title" href="${href}">${escapeHtml(issue.title)}</a>
      <span class="page-strip__meta">by <a href="${escapeHtml(authorUrl)}" rel="external">@${escapeHtml(issue.author.login)}</a> · ${issue.commentCount} ${issue.commentCount === 1 ? "reply" : "replies"}</span>
      ${issue.excerpt ? `<p class="reader-strip__excerpt">${escapeHtml(issue.excerpt)}</p>` : ""}
    </div>
    <span class="page-strip__date"><span>${issue.state === "closed" ? "Closed" : "Updated"}</span>${datetime(issue.updatedAt)}</span>
  </article>`;
}

export function repositoryReaderPage(result: PublicIssueList): string {
  const repoUrl = `https://github.com/${encodeURIComponent(result.repository.owner)}/${encodeURIComponent(result.repository.repo)}`;
  const issues = result.issues.length
    ? result.issues.map((issue) => publicIssueStrip(result.repository, issue)).join("")
    : '<div class="empty-state"><strong>No issues on this result page.</strong><br>This GitHub page may be empty or contain only pull requests.</div>';
  return `<div class="listing-shell reader-listing">
    ${freshnessNotice(result.stale, result.cachedAt)}
    <p class="eyebrow">Public repository reader</p>
    <h1 class="listing-title">${escapeHtml(result.repository.owner)}<span class="repo-slash">/</span>${escapeHtml(result.repository.repo)}</h1>
    <p class="listing-intro">Issues are fetched from GitHub and rendered as read-only pages. Pull requests are excluded; nothing here enters IssuePages search or discovery.</p>
    <div class="reader-actions">
      <a class="button button--light" href="/read">Choose another repository</a>
      <a class="text-link" href="${repoUrl}" rel="external">Open repository on GitHub ↗</a>
    </div>
    <div class="listing">${issues}</div>
    ${result.nextCursor || result.page > 1 ? `<nav class="pagination pagination--reader" aria-label="Pagination">${result.page > 1 ? `<a class="text-link" href="${readerRepositoryHref(result.repository)}">← Newest results</a>` : ""}${result.nextCursor ? `<a class="button button--light" href="${readerRepositoryHref(result.repository, result.nextCursor)}">Older GitHub results →</a>` : ""}</nav>` : ""}
  </div>`;
}

function publicLabels(labels: PublicIssueSummary["labels"]): string {
  if (labels.length === 0) return "";
  return `<div class="tags" aria-label="Labels">${labels
    .map((label) => `<span class="tag">${escapeHtml(label.name)}</span>`)
    .join("")}</div>`;
}

function publicCommentView(comment: PublicComment): string {
  const avatar = safeHttpsUrl(comment.author.avatarUrl);
  const authorUrl = safeHttpsUrl(comment.author.githubUrl) ?? "https://github.com";
  return `<article class="comment" id="comment-${comment.id}">
    ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" width="48" height="48" loading="lazy" alt="">` : '<span class="avatar" aria-hidden="true"></span>'}
    <div>
      <div class="comment__meta"><a href="${escapeHtml(authorUrl)}" rel="external">@${escapeHtml(comment.author.login)}</a> · ${datetime(comment.createdAt)} · <a href="${escapeHtml(comment.githubUrl)}" rel="external">source ↗</a></div>
      <div class="prose">${comment.bodyHtml}</div>
      ${reactionList(JSON.stringify(comment.reactions), `Comment by ${comment.author.login}`, comment.githubUrl)}
    </div>
  </article>`;
}

export function publicIssueReaderPage(result: PublicIssuePage): string {
  const { repository, issue } = result;
  const archived = issue.state === "closed";
  const repoHref = readerRepositoryHref(repository);
  const authorUrl = safeHttpsUrl(issue.author.githubUrl) ?? "https://github.com";
  const discussionHref = `${repoHref}/issues/${issue.number}/discussion`;
  const discussion =
    issue.commentCount === 0
      ? '<div class="empty-state">No replies yet. Discussion stays on the original GitHub issue.</div>'
      : `<div class="discussion-content discussion-content--loading" data-reader-discussion data-source="${discussionHref}" data-github-source="${escapeHtml(issue.githubUrl)}" aria-live="polite" aria-busy="true">
          <div class="discussion-loading" role="status"><span aria-hidden="true">↳</span><span><strong>Loading the discussion</strong><br>Article reading is ready now.</span></div>
        </div>`;
  return `<div class="page-shell reader-page">
    <aside class="page-rail" aria-label="Issue details">
      <p class="eyebrow">${escapeHtml(repository.owner)}/${escapeHtml(repository.repo)} · Issue #${issue.number}</p>
      <h1>${escapeHtml(issue.title)}</h1>
      ${publicLabels(issue.labels)}
      <dl>
        <dt>Author</dt><dd><a href="${escapeHtml(authorUrl)}" rel="external">@${escapeHtml(issue.author.login)}</a></dd>
        <dt>Opened</dt><dd>${datetime(issue.createdAt)}</dd>
        <dt>Last edited</dt><dd>${datetime(issue.updatedAt)}</dd>
        <dt>GitHub state</dt><dd>${archived ? "Closed" : "Open"}</dd>
      </dl>
      <a class="button button--light" href="${escapeHtml(issue.githubUrl)}" rel="external">Open on GitHub <span aria-hidden="true">↗</span></a>
      <a class="rail-back" href="${repoHref}">← All repository issues</a>
    </aside>
    <article class="article-pane">
      ${freshnessNotice(result.stale, result.cachedAt)}
      ${archived ? '<div class="archive-notice"><strong>Closed issue.</strong> This read-only page remains available while GitHub exposes the source.</div>' : ""}
      <div class="prose">${issue.bodyHtml || '<p class="empty-state">This issue has no body.</p>'}</div>
      ${reactionList(JSON.stringify(issue.reactions), "Issue", issue.githubUrl)}
      <section class="discussion" aria-labelledby="discussion-title">
        <h2 id="discussion-title">Discussion <span>${issue.commentCount}</span></h2>
        ${discussion}
      </section>
      <nav class="onward onward--reader" aria-label="Keep reading">
        <h2>Keep reading</h2>
        <a href="${repoHref}">More from this repository</a>
        <a href="/read">Choose another repository</a>
        <a href="/">Visit the publishing experiment</a>
      </nav>
    </article>
  </div>`;
}

export function publicDiscussionFragment(
  result: PublicIssueDiscussion,
  githubIssueUrl: string,
): string {
  const comments = result.comments.length
    ? result.comments.map(publicCommentView).join("")
    : '<div class="empty-state">No replies are currently visible. Discussion stays on the original GitHub issue.</div>';
  return `${freshnessNotice(result.stale, result.cachedAt)}${comments}${
    result.commentsTruncated
      ? `<p class="reader-notice"><strong>Showing the first ${result.comments.length} comments.</strong> <a href="${escapeHtml(githubIssueUrl)}" rel="external">Continue on GitHub ↗</a></p>`
      : ""
  }`;
}

export function readerErrorPage(
  code: number,
  heading: string,
  detail: string,
  options: { repositoryHref?: string; repositoryLabel?: string; retryHref?: string } = {},
): string {
  return `<div class="listing-shell">
    <div class="error-code" aria-hidden="true">${code}</div>
    <h1 class="listing-title">${escapeHtml(heading)}</h1>
    <p class="listing-intro">${escapeHtml(detail)}</p>
    <div class="reader-actions reader-actions--error">
      ${options.retryHref ? `<a class="button" href="${escapeHtml(options.retryHref)}">Try again →</a>` : ""}
      ${options.repositoryHref ? `<a class="button button--light" href="${escapeHtml(options.repositoryHref)}">${escapeHtml(options.repositoryLabel ?? "Back to repository")}</a>` : ""}
      <a class="text-link" href="/read">Choose another repository</a>
    </div>
  </div>`;
}
