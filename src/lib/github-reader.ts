import { normalizeGitHubHtml, repositoryBaseUrl } from "./github-html";
import { slugify } from "./slug";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const GITHUB_JSON_MEDIA = "application/vnd.github+json";
const GITHUB_FULL_MEDIA = "application/vnd.github.full+json";
const FRESH_TTL_SECONDS = 600;
const SOFT_STALE_TTL_SECONDS = 3_600;
const STALE_TTL_SECONDS = 604_800;
const UPSTREAM_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const LIST_PAGE_SIZE = 12;
const COMMENT_LIMIT = 50;
const CACHE_SCHEMA = 1;

export const GITHUB_READER_POLICY = Object.freeze({
  freshTtlSeconds: FRESH_TTL_SECONDS,
  softStaleTtlSeconds: SOFT_STALE_TTL_SECONDS,
  staleTtlSeconds: STALE_TTL_SECONDS,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
  listPageSize: LIST_PAGE_SIZE,
});

interface ReaderExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PublicRepository {
  owner: string;
  repo: string;
}

export interface PublicLabel {
  name: string;
  color: string;
}

export interface PublicAuthor {
  login: string;
  avatarUrl: string;
  githubUrl: string;
}

export interface PublicIssueSummary {
  number: number;
  title: string;
  slug: string;
  excerpt: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  author: PublicAuthor;
  labels: PublicLabel[];
  commentCount: number;
  githubUrl: string;
}

export interface PublicIssue extends PublicIssueSummary {
  bodyHtml: string;
  bodyText: string;
  reactions: Record<string, number>;
  hasMermaid: boolean;
}

export interface PublicComment {
  id: number;
  bodyHtml: string;
  bodyText: string;
  createdAt: string;
  updatedAt: string;
  author: PublicAuthor;
  reactions: Record<string, number>;
  githubUrl: string;
  hasMermaid: boolean;
}

export interface ReaderFreshness {
  stale: boolean;
  refreshing: boolean;
  cachedAt: string;
}

export interface PublicIssueList extends ReaderFreshness {
  repository: PublicRepository;
  issues: PublicIssueSummary[];
  page: number;
  nextCursor: string | null;
}

export interface PublicIssuePage extends ReaderFreshness {
  repository: PublicRepository;
  issue: PublicIssue;
}

export interface PublicIssueDiscussion extends ReaderFreshness {
  repository: PublicRepository;
  issueNumber: number;
  comments: PublicComment[];
  commentsTruncated: boolean;
}

interface CacheEnvelope<T> {
  version: 1;
  storedAt: string;
  etag: string | null;
  value: T;
}

interface CachedResult<T> {
  value: T;
  freshness: ReaderFreshness;
}

export class GitHubReaderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: "invalid" | "not_found" | "rate_limited" | "unavailable",
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRepositoryPart(value: string, owner: boolean): boolean {
  if (value.length === 0 || value.length > (owner ? 39 : 100)) return false;
  if (value === "." || value === "..") return false;
  return owner ? /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(value) : /^[a-z\d._-]+$/i.test(value);
}

export function parsePublicRepository(value: string): PublicRepository | null {
  const input = value.normalize("NFKC").trim();
  if (!input || input.length > 300) return null;
  let path = input;
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    path = url.pathname.replace(/^\/+|\/+$/g, "");
  }
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!isRepositoryPart(owner, true) || !isRepositoryPart(repo, false)) return null;
  return { owner, repo };
}

export function encodeReaderCursor(page: number): string {
  return btoa(JSON.stringify({ version: 1, page }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function decodeReaderCursor(value: string | undefined): number | null {
  if (!value || value.length > 100) return value ? null : 1;
  try {
    const source = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(source.padEnd(Math.ceil(source.length / 4) * 4, "=")));
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    return Number.isSafeInteger(parsed.page) &&
      Number(parsed.page) > 0 &&
      Number(parsed.page) <= 500
      ? Number(parsed.page)
      : null;
  } catch {
    return null;
  }
}

function authorFrom(value: unknown): PublicAuthor {
  if (!isRecord(value)) return { login: "ghost", avatarUrl: "", githubUrl: "https://github.com" };
  return {
    login: typeof value.login === "string" && value.login ? value.login : "ghost",
    avatarUrl: typeof value.avatar_url === "string" ? value.avatar_url : "",
    githubUrl: typeof value.html_url === "string" ? value.html_url : "https://github.com",
  };
}

function labelsFrom(value: unknown): PublicLabel[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((label) => {
    if (typeof label === "string") return [{ name: label, color: "8c887a" }];
    if (!isRecord(label) || typeof label.name !== "string") return [];
    return [
      {
        name: label.name,
        color:
          typeof label.color === "string" && /^[\da-f]{6}$/i.test(label.color)
            ? label.color
            : "8c887a",
      },
    ];
  });
}

function reactionsFrom(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const allowed = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const count = value[name];
      return typeof count === "number" && Number.isSafeInteger(count) && count > 0
        ? [[name, count] as const]
        : [];
    }),
  );
}

function excerpt(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217).trimEnd()}…` : compact;
}

function issueSummaryFrom(value: unknown): PublicIssueSummary | null {
  if (!isRecord(value) || "pull_request" in value) return null;
  if (
    typeof value.number !== "number" ||
    !Number.isSafeInteger(value.number) ||
    typeof value.title !== "string" ||
    typeof value.html_url !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    (value.state !== "open" && value.state !== "closed")
  )
    return null;
  const bodyText =
    typeof value.body_text === "string"
      ? value.body_text
      : typeof value.body === "string"
        ? value.body
        : "";
  return {
    number: value.number,
    title: value.title,
    slug: slugify(value.title),
    excerpt: excerpt(bodyText),
    state: value.state,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    author: authorFrom(value.user),
    labels: labelsFrom(value.labels),
    commentCount:
      typeof value.comments === "number" && Number.isSafeInteger(value.comments)
        ? Math.max(0, value.comments)
        : 0,
    githubUrl: value.html_url,
  };
}

function issueFrom(value: unknown, repository: PublicRepository): PublicIssue | null {
  const summary = issueSummaryFrom(value);
  if (!summary || !isRecord(value)) return null;
  const rawHtml = typeof value.body_html === "string" ? value.body_html : "";
  const normalized = normalizeGitHubHtml(rawHtml, {
    sourceUrl: summary.githubUrl,
    baseUrl: repositoryBaseUrl(`${repository.owner}/${repository.repo}`),
  });
  return {
    ...summary,
    bodyHtml: normalized.html,
    bodyText:
      typeof value.body_text === "string"
        ? value.body_text
        : typeof value.body === "string"
          ? value.body
          : "",
    reactions: reactionsFrom(value.reactions),
    hasMermaid: normalized.features.mermaid,
  };
}

function commentFrom(value: unknown, repository: PublicRepository): PublicComment | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    typeof value.html_url !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  )
    return null;
  const rawHtml = typeof value.body_html === "string" ? value.body_html : "";
  const normalized = normalizeGitHubHtml(rawHtml, {
    sourceUrl: value.html_url,
    baseUrl: repositoryBaseUrl(`${repository.owner}/${repository.repo}`),
  });
  return {
    id: value.id,
    bodyHtml: normalized.html,
    bodyText: typeof value.body_text === "string" ? value.body_text : "",
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    author: authorFrom(value.user),
    reactions: reactionsFrom(value.reactions),
    githubUrl: value.html_url,
    hasMermaid: normalized.features.mermaid,
  };
}

function cacheKey(origin: string, freshness: "fresh" | "stale", key: string): Request {
  const digest = encodeURIComponent(key.toLowerCase());
  return new Request(
    new URL(`/__cache/github-reader/v${CACHE_SCHEMA}/${freshness}/${digest}`, origin),
    {
      method: "GET",
    },
  );
}

function isCacheEnvelope<T>(
  value: unknown,
  validate: (entry: unknown) => entry is T,
): value is CacheEnvelope<T> {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.storedAt === "string" &&
    Number.isFinite(Date.parse(value.storedAt)) &&
    (typeof value.etag === "string" || value.etag === null) &&
    validate(value.value)
  );
}

async function readCached<T>(
  request: Request,
  validate: (entry: unknown) => entry is T,
): Promise<CacheEnvelope<T> | null> {
  try {
    const response = await caches.default.match(request);
    if (!response) return null;
    const value: unknown = await response.json();
    return isCacheEnvelope(value, validate) ? value : null;
  } catch {
    return null;
  }
}

function cacheResponse<T>(value: CacheEnvelope<T>, ttl: number): Response {
  return Response.json(value, {
    headers: { "Cache-Control": `public, s-maxage=${ttl}` },
  });
}

function writeCached<T>(origin: string, key: string, value: CacheEnvelope<T>): Promise<void> {
  return Promise.all([
    caches.default.put(cacheKey(origin, "fresh", key), cacheResponse(value, FRESH_TTL_SECONDS)),
    caches.default.put(cacheKey(origin, "stale", key), cacheResponse(value, STALE_TTL_SECONDS)),
  ]).then(() => undefined);
}

function deleteCached(origin: string, key: string): Promise<void> {
  return Promise.all([
    caches.default.delete(cacheKey(origin, "fresh", key)),
    caches.default.delete(cacheKey(origin, "stale", key)),
  ]).then(() => undefined);
}

async function readResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new GitHubReaderError(502, "unavailable");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new GitHubReaderError(502, "unavailable");
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

function mapGitHubFailure(response: Response): GitHubReaderError {
  if (response.status === 404 || response.status === 410 || response.status === 403) {
    if (
      response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))
    ) {
      return new GitHubReaderError(503, "rate_limited");
    }
    return new GitHubReaderError(404, "not_found");
  }
  if (response.status === 429) return new GitHubReaderError(503, "rate_limited");
  return new GitHubReaderError(503, "unavailable");
}

async function githubRequest(
  path: string,
  etag: string | null,
  mediaType: typeof GITHUB_JSON_MEDIA | typeof GITHUB_FULL_MEDIA,
): Promise<Response> {
  const headers = new Headers({
    Accept: mediaType,
    "User-Agent": "IssuePages-public-reader",
    "X-GitHub-Api-Version": API_VERSION,
  });
  if (etag) headers.set("If-None-Match", etag);
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  let url = new URL(`${GITHUB_API}${path}`);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(url.toString(), {
      headers,
      redirect: "manual",
      signal,
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          "200-299": FRESH_TTL_SECONDS,
          "300-599": 0,
        },
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location || redirects >= 2) throw new GitHubReaderError(503, "unavailable");
    let target: URL;
    try {
      target = new URL(location, url);
    } catch {
      throw new GitHubReaderError(503, "unavailable");
    }
    const publicIssuePath =
      /^\/(?:repositories\/[1-9]\d*|repos\/[a-z\d-]+\/[a-z\d._-]+)\/issues(?:\/[1-9]\d*(?:\/comments)?)?$/i;
    if (
      target.origin !== GITHUB_API ||
      target.username ||
      target.password ||
      target.hash ||
      !publicIssuePath.test(target.pathname)
    )
      throw new GitHubReaderError(503, "unavailable");
    url = target;
  }
}

async function cachedGitHubRead<T>(options: {
  origin: string;
  key: string;
  path: string;
  mediaType: typeof GITHUB_JSON_MEDIA | typeof GITHUB_FULL_MEDIA;
  ctx: ReaderExecutionContext;
  validate: (entry: unknown) => entry is T;
  transform: (payload: unknown, response: Response) => T;
}): Promise<CachedResult<T>> {
  const freshKey = cacheKey(options.origin, "fresh", options.key);
  const staleKey = cacheKey(options.origin, "stale", options.key);
  const fresh = await readCached(freshKey, options.validate);
  if (fresh) {
    return {
      value: fresh.value,
      freshness: { stale: false, refreshing: false, cachedAt: fresh.storedAt },
    };
  }
  const staleCandidate = await readCached(staleKey, options.validate);
  const stale =
    staleCandidate && Date.now() - Date.parse(staleCandidate.storedAt) <= STALE_TTL_SECONDS * 1_000
      ? staleCandidate
      : null;

  const refresh = async (): Promise<CachedResult<T>> => {
    try {
      const response = await githubRequest(options.path, stale?.etag ?? null, options.mediaType);
      if (response.status === 304 && stale) {
        const refreshed = { ...stale, storedAt: new Date().toISOString() };
        options.ctx.waitUntil(writeCached(options.origin, options.key, refreshed));
        return {
          value: refreshed.value,
          freshness: { stale: false, refreshing: false, cachedAt: refreshed.storedAt },
        };
      }
      if (!response.ok) throw mapGitHubFailure(response);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        throw new GitHubReaderError(503, "unavailable");
      }
      const payloadText = await readResponseText(response);
      let payload: unknown;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        throw new GitHubReaderError(503, "unavailable");
      }
      const value = options.transform(payload, response);
      const envelope: CacheEnvelope<T> = {
        version: 1,
        storedAt: new Date().toISOString(),
        etag: response.headers.get("etag"),
        value,
      };
      options.ctx.waitUntil(writeCached(options.origin, options.key, envelope));
      return {
        value,
        freshness: { stale: false, refreshing: false, cachedAt: envelope.storedAt },
      };
    } catch (error) {
      if (error instanceof GitHubReaderError && error.code === "not_found") {
        options.ctx.waitUntil(deleteCached(options.origin, options.key));
      }
      throw error;
    }
  };

  const staleAge = stale ? Date.now() - Date.parse(stale.storedAt) : Number.POSITIVE_INFINITY;
  if (stale && staleAge <= SOFT_STALE_TTL_SECONDS * 1_000) {
    options.ctx.waitUntil(
      refresh().catch((error) => {
        if (!(error instanceof GitHubReaderError && error.code === "not_found")) {
          console.error(
            JSON.stringify({
              event: "github_reader_background_refresh_failed",
              key: options.key,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      }),
    );
    return {
      value: stale.value,
      freshness: { stale: false, refreshing: true, cachedAt: stale.storedAt },
    };
  }

  try {
    return await refresh();
  } catch (error) {
    if (error instanceof GitHubReaderError && error.code === "not_found") throw error;
    if (stale) {
      return {
        value: stale.value,
        freshness: { stale: true, refreshing: false, cachedAt: stale.storedAt },
      };
    }
    console.error(
      JSON.stringify({
        event: "github_reader_fetch_failed",
        key: options.key,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    if (error instanceof GitHubReaderError) throw error;
    throw new GitHubReaderError(503, "unavailable");
  }
}

function hasNextPage(response: Response): boolean {
  return /<[^>]+>;\s*rel="next"/.test(response.headers.get("link") ?? "");
}

function isIssueList(value: unknown): value is { issues: PublicIssueSummary[]; next: boolean } {
  return (
    isRecord(value) &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        isRecord(issue) &&
        typeof issue.number === "number" &&
        typeof issue.title === "string" &&
        typeof issue.slug === "string" &&
        (issue.state === "open" || issue.state === "closed"),
    ) &&
    typeof value.next === "boolean"
  );
}

function isPublicIssue(value: unknown): value is PublicIssue {
  return isRecord(value) && typeof value.number === "number" && typeof value.bodyHtml === "string";
}

function isCommentList(value: unknown): value is { comments: PublicComment[]; next: boolean } {
  return (
    isRecord(value) &&
    Array.isArray(value.comments) &&
    value.comments.every(
      (comment) =>
        isRecord(comment) && typeof comment.id === "number" && typeof comment.bodyHtml === "string",
    ) &&
    typeof value.next === "boolean"
  );
}

function apiRepositoryPath(repository: PublicRepository): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

export async function listPublicIssues(options: {
  repository: PublicRepository;
  page: number;
  label?: string;
  author?: string;
  origin: string;
  ctx: ReaderExecutionContext;
}): Promise<PublicIssueList> {
  const base = apiRepositoryPath(options.repository);
  const label = options.label?.normalize("NFKC").trim() ?? "";
  const labelQuery = label ? `&labels=${encodeURIComponent(label)}` : "";
  const author = options.author?.normalize("NFKC").trim() ?? "";
  const authorQuery = author ? `&creator=${encodeURIComponent(author)}` : "";
  const result = await cachedGitHubRead({
    origin: options.origin,
    key: `list:${options.repository.owner}/${options.repository.repo}:${label || "*"}:${author || "*"}:${options.page}`,
    path: `${base}/issues?state=all&sort=updated&direction=desc&per_page=${LIST_PAGE_SIZE}&page=${options.page}${labelQuery}${authorQuery}`,
    mediaType: GITHUB_JSON_MEDIA,
    ctx: options.ctx,
    validate: isIssueList,
    transform(payload, response) {
      if (!Array.isArray(payload)) throw new GitHubReaderError(503, "unavailable");
      return {
        issues: payload.flatMap((entry) => {
          const issue = issueSummaryFrom(entry);
          return issue ? [issue] : [];
        }),
        next: hasNextPage(response),
      };
    },
  });
  return {
    repository: options.repository,
    issues: result.value.issues,
    page: options.page,
    nextCursor: result.value.next ? encodeReaderCursor(options.page + 1) : null,
    ...result.freshness,
  };
}

export async function getPublicIssue(options: {
  repository: PublicRepository;
  issueNumber: number;
  origin: string;
  ctx: ReaderExecutionContext;
}): Promise<PublicIssuePage> {
  const base = apiRepositoryPath(options.repository);
  const result = await cachedGitHubRead({
    origin: options.origin,
    key: `issue:${options.repository.owner}/${options.repository.repo}:${options.issueNumber}`,
    path: `${base}/issues/${options.issueNumber}`,
    mediaType: GITHUB_FULL_MEDIA,
    ctx: options.ctx,
    validate: isPublicIssue,
    transform(payload) {
      const issue = issueFrom(payload, options.repository);
      if (!issue) throw new GitHubReaderError(404, "not_found");
      return issue;
    },
  });
  return {
    repository: options.repository,
    issue: result.value,
    ...result.freshness,
  };
}

export async function getPublicIssueDiscussion(options: {
  repository: PublicRepository;
  issueNumber: number;
  origin: string;
  ctx: ReaderExecutionContext;
}): Promise<PublicIssueDiscussion> {
  const base = apiRepositoryPath(options.repository);
  const result = await cachedGitHubRead({
    origin: options.origin,
    key: `comments:${options.repository.owner}/${options.repository.repo}:${options.issueNumber}`,
    path: `${base}/issues/${options.issueNumber}/comments?per_page=${COMMENT_LIMIT}&page=1`,
    mediaType: GITHUB_FULL_MEDIA,
    ctx: options.ctx,
    validate: isCommentList,
    transform(payload, response) {
      if (!Array.isArray(payload)) throw new GitHubReaderError(503, "unavailable");
      return {
        comments: payload.flatMap((entry) => {
          const comment = commentFrom(entry, options.repository);
          return comment ? [comment] : [];
        }),
        next: hasNextPage(response),
      };
    },
  });
  return {
    repository: options.repository,
    issueNumber: options.issueNumber,
    comments: result.value.comments,
    commentsTruncated: result.value.next,
    ...result.freshness,
  };
}
