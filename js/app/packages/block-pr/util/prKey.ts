/**
 * A PR block is addressed in the URL by an encoded PR key:
 * `{owner}~{repo}~{number}`. `~` is URL-safe and not a legal character in
 * GitHub owner or repository names, so the encoding is unambiguous.
 */
export type PrRef = {
  owner: string;
  repo: string;
  number: number;
};

const PR_KEY_SEPARATOR = '~';

const GITHUB_PR_URL_PATTERN =
  /github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)/;

export function encodePrKey(ref: PrRef): string {
  return [ref.owner, ref.repo, ref.number].join(PR_KEY_SEPARATOR);
}

export function decodePrKey(id: string): PrRef | null {
  const parts = id.split(PR_KEY_SEPARATOR);
  if (parts.length !== 3) return null;
  const [owner, repo, numberPart] = parts;
  const number = Number(numberPart);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) return null;
  return { owner, repo, number };
}

/** Extract a PR reference from a github.com pull request URL, if present. */
export function parseGithubPrUrl(text: string): PrRef | null {
  const match = text.match(GITHUB_PR_URL_PATTERN);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** The backend `github_key` format used by `github_pr_tasks` et al. */
export function toGithubKey(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}/pull/${ref.number}`;
}

export function prDisplayName(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

export function prHtmlUrl(ref: PrRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
}
