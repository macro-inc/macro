import type { PrRef } from '@app/features/block-pr/util/prKey';

const GITHUB_HOSTNAMES = new Set(['github.com', 'www.github.com']);
const GITHUB_PR_PATH_PATTERN =
  /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)(?:\/.*)?$/;

/**
 * Parse a pasted github.com pull request URL, including its subpages such as
 * `/files`. Text with anything besides the URL is not a PR link paste.
 */
export function parsePastedGithubPrUrl(text: string): PrRef | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!GITHUB_HOSTNAMES.has(url.hostname)) return null;

  const match = url.pathname.match(GITHUB_PR_PATH_PATTERN);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
