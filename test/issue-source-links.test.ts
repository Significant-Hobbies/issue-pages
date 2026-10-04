import { describe, expect, it } from "vitest";
import { articlePage } from "../src/ui/templates";
import type { ArticleRow, CommentRow } from "../src/types";
import {
  canonicalizeTransferredIssueUrl,
  rewriteTransferredIssueHrefs,
} from "../src/lib/issue-source-links";

const oldIssueUrl = (number: number) =>
  `https://github.com/sarthakagrawal927/issue-pages/issues/${number}`;
const currentIssueUrl = (number: number) =>
  `https://github.com/Significant-Hobbies/issue-pages/issues/${number}`;

describe("transferred IssuePages source links", () => {
  it.each([4, 8])("canonicalizes only the proven issue %s URL", (number) => {
    expect(canonicalizeTransferredIssueUrl(oldIssueUrl(number))).toBe(currentIssueUrl(number));
    expect(canonicalizeTransferredIssueUrl(`${oldIssueUrl(number)}#issuecomment-5410118487`)).toBe(
      `${currentIssueUrl(number)}#issuecomment-5410118487`,
    );
  });

  it("leaves unproven issues, repositories, queries, and fragments unchanged", () => {
    for (const value of [
      oldIssueUrl(5),
      "https://github.com/sarthakagrawal927/other-repo/issues/4",
      `${oldIssueUrl(4)}?tab=comments`,
      `${oldIssueUrl(4)}#discussion_r5410118487`,
      "https://github.com.evil/sarthakagrawal927/issue-pages/issues/4",
    ]) {
      expect(canonicalizeTransferredIssueUrl(value)).toBe(value);
    }
  });

  it("rewrites only href attributes and preserves visible text and unrelated links", () => {
    const old = oldIssueUrl(4);
    const html = `<p><a href="${old}">Open original</a></p><p>${old}</p><div data-href="${old}"></div><a href="https://github.com/acme/notes/issues/4">Other source</a>`;
    const rewritten = rewriteTransferredIssueHrefs(html);
    expect(rewritten).toContain(`<a href="${currentIssueUrl(4)}">Open original</a>`);
    expect(rewritten).toContain(`<p>${old}</p>`);
    expect(rewritten).toContain(`data-href="${old}"`);
    expect(rewritten).toContain('href="https://github.com/acme/notes/issues/4"');
  });

  it.each([4, 8])(
    "renders issue %s and comment source links at the canonical repository",
    (number) => {
      const commentId = number === 4 ? 5410118487 : 5410156172;
      const source = oldIssueUrl(number);
      const commentSource = `${source}#issuecomment-${commentId}`;
      const article = {
        issue_id: number,
        issue_number: number,
        title: `Article ${number}`,
        slug: `article-${number}`,
        excerpt: "Excerpt",
        state: "open",
        published_at: "2026-08-21T10:00:00.000Z",
        last_public_at: "2026-08-25T10:00:00.000Z",
        public_revision: 1,
        reactions_json: '{"heart":2}',
        author_login: "writer",
        author_avatar_url: "",
        labels: null,
        comment_count: 1,
        author_id: 1,
        author_github_url: "https://github.com/writer",
        body_markdown: "Open the original source.",
        body_html: `<p><a href="${source}">Open the original source</a></p>`,
        body_text: "Open the original source.",
        github_url: source,
        github_created_at: "2026-08-21T10:00:00.000Z",
        github_updated_at: "2026-08-25T10:00:00.000Z",
        visibility: "published",
      } satisfies ArticleRow;
      const comment = {
        github_id: commentId,
        body_html: `<p><a href="${commentSource}">Open comment source</a></p>`,
        body_text: "Open comment source.",
        github_url: commentSource,
        github_created_at: "2026-08-21T11:00:00.000Z",
        github_updated_at: "2026-08-21T11:00:00.000Z",
        reactions_json: '{"+1":1}',
        author_login: "commenter",
        author_avatar_url: "",
        author_github_url: "https://github.com/commenter",
      } satisfies CommentRow;

      const rendered = articlePage(article, [comment]);
      expect(rendered).toContain(`href="${currentIssueUrl(number)}"`);
      expect(rendered).toContain(`href="${currentIssueUrl(number)}#issuecomment-${commentId}"`);
      expect(rendered).toContain("Open the original source");
      expect(rendered).toContain("Open comment source");
      expect(rendered).not.toContain(source);
    },
  );
});
