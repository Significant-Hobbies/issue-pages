import type { ArticleMutation } from "../data/repository";

const ARTICLE_CACHE_SCHEMA = 3;

export function articleCacheKey(origin: string, issueNumber: number, revision: number): Request {
  const url = new URL(
    `/__cache/articles/v${ARTICLE_CACHE_SCHEMA}/${issueNumber}/${revision}`,
    origin,
  );
  return new Request(url.toString(), { method: "GET" });
}

export async function invalidateArticleCache(
  origin: string,
  mutation: ArticleMutation | null,
): Promise<void> {
  if (!mutation || mutation.previousRevision <= 0) return;
  const cache = caches.default;
  await cache.delete(articleCacheKey(origin, mutation.issueNumber, mutation.previousRevision));
}
