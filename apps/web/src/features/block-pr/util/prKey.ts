export type PrRef = {
  owner: string;
  repo: string;
  number: number;
};

const GITHUB_PR_URL_PATTERN =
  /github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)/;

/** Extract a PR reference from a github.com pull request URL, if present. */
export function parseGithubPrUrl(text: string): PrRef | null {
  const match = text.match(GITHUB_PR_URL_PATTERN);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** Extract a PR reference from the backend `github_key` format. */
export function parseGithubKey(key: string): PrRef | null {
  const match = key.match(
    /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)$/
  );
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
