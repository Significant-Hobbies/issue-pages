import { escapeAttribute } from "./html";

const LEGACY_ISSUE_PATH = /^\/sarthakagrawal927\/issue-pages\/issues\/(4|8)$/;
const ISSUE_COMMENT_FRAGMENT = /^#issuecomment-\d+$/;
const CURRENT_GITHUB_ISSUES = "https://github.com/Significant-Hobbies/issue-pages/issues";

/** Canonicalize only the two issue URLs whose repository transfer is verified. */
export function canonicalizeTransferredIssueUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== ""
  ) {
    return value;
  }

  const match = LEGACY_ISSUE_PATH.exec(url.pathname);
  if (!match || (url.hash !== "" && !ISSUE_COMMENT_FRAGMENT.test(url.hash))) return value;

  return `${CURRENT_GITHUB_ISSUES}/${match[1]}${url.hash}`;
}

export function rewriteTransferredIssueHrefs(html: string): string {
  return html.replace(
    /(\s)(href=)(["'])([^"']*)\3/gi,
    (attribute, whitespace: string, name: string, quote: string, href: string) => {
      const canonical = canonicalizeTransferredIssueUrl(href);
      return canonical === href
        ? attribute
        : `${whitespace}${name}${quote}${escapeAttribute(canonical)}${quote}`;
    },
  );
}
