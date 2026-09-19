/**
 * Repositories a coder can be pointed at. Kept as canonical https URLs so the
 * same repository typed three ways dedupes to one recent entry.
 */

const GITHUB_URL =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/\S*|[#?]\S*)?$/i;
const GITHUB_SSH = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const SHORTHAND = /^([\w.-]+)\/([\w.-]+)$/;
const ANY_HTTPS = /^https?:\/\/[^/\s]+\/\S+\/\S+$/i;

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, a GitHub https or ssh URL, or
 * a full https URL on another host. Returns the canonical URL, or undefined
 * when the text does not name a repository.
 */
export function parseRepositoryInput(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;

  const github = text.match(GITHUB_URL) ?? text.match(GITHUB_SSH);
  if (github) return `https://github.com/${github[1]}/${github[2]}`;

  const shorthand = text.match(SHORTHAND);
  if (shorthand) {
    return `https://github.com/${shorthand[1]}/${shorthand[2]}`;
  }

  if (ANY_HTTPS.test(text)) {
    return text.replace(/\.git$/i, '').replace(/\/+$/, '');
  }
  return undefined;
}

/** `https://github.com/macro-inc/macro` → `macro-inc/macro`. */
export function repositoryLabel(url: string): string {
  const path = url
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  const repo = path.at(-1);
  const owner = path.at(-2);
  return owner && repo && !owner.includes(':')
    ? `${owner}/${repo}`
    : (repo ?? url);
}

/** `https://github.com/macro-inc/macro` → `macro`; used where the owner is noise. */
export function repositoryShortName(url: string): string {
  return repositoryLabel(url).split('/').at(-1) ?? url;
}

/** Git branch names, excluding revision expressions and ref shorthand. */
export function validRepositoryBranch(branch: string): boolean {
  return (
    !!branch &&
    branch !== '@' &&
    !branch.startsWith('-') &&
    !branch.endsWith('.') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    !/[\s~^:?*\[\\]/.test(branch) &&
    !Array.from(branch).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) &&
    branch
      .split('/')
      .every(
        (part) => !!part && !part.startsWith('.') && !part.endsWith('.lock')
      )
  );
}

/** A repository the signed-in user can hand a coder, as the harness lists it. */
export type ReachableRepository = {
  /** The canonical https URL, the form the create-session API accepts. */
  url: string;
  /** The branch its clones check out; absent for a repository with no commits. */
  defaultBranch?: string;
};

/** The branch a coder starts on when the repository has none to offer. */
const FALLBACK_BRANCH = 'main';

/** GitHub treats owner and repository names case-insensitively, so two spellings are one repository. */
export function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** One repository the caller has used, and when that last happened. */
export type RepositoryTouch = {
  url: string;
  /** Epoch millis; newer values win when the same repository is touched twice. */
  at: number;
};

/**
 * Record a use of `url` at `at`. A later timestamp replaces an earlier one
 * for the same repository (any spelling); an older timestamp is ignored.
 * Newest first.
 */
export function touchRepository(
  recents: readonly RepositoryTouch[],
  url: string,
  at: number
): RepositoryTouch[] {
  const current = recents.find((recent) => sameRepository(recent.url, url));
  if (current && current.at > at) return [...recents];
  return recentRepositoryTouches([
    { url, at },
    ...recents.filter((recent) => !sameRepository(recent.url, url)),
  ]);
}

function recentRepositoryTouches(
  recents: readonly RepositoryTouch[]
): RepositoryTouch[] {
  return [...recents].toSorted((left, right) => right.at - left.at);
}

/** Newest-first urls from recorded uses. */
export function recentRepositoryUrls(
  recents: readonly RepositoryTouch[]
): string[] {
  return [...recents]
    .toSorted((left, right) => right.at - left.at)
    .map((recent) => recent.url);
}

/**
 * Stored recents: the current `{ url, at }[]` shape, or the earlier newest-first
 * `string[]` (assigned decreasing timestamps so that order is kept).
 */
export function parseRepositoryTouches(
  stored: unknown,
  now = Date.now()
): RepositoryTouch[] {
  if (!Array.isArray(stored)) return [];
  return stored.reduce<RepositoryTouch[]>((touches, entry, index) => {
    if (typeof entry === 'string') {
      return touchRepository(touches, entry, now - index);
    }
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as RepositoryTouch).url !== 'string' ||
      typeof (entry as RepositoryTouch).at !== 'number' ||
      !Number.isFinite((entry as RepositoryTouch).at)
    ) {
      return touches;
    }
    return touchRepository(
      touches,
      (entry as RepositoryTouch).url,
      (entry as RepositoryTouch).at
    );
  }, []);
}

/**
 * The repositories to offer: recents first, in their own order, then every
 * other reachable repository as the harness sorted it. A recent the listing
 * no longer carries stays offered - the service, not this list, decides what
 * a session may use, and it says so when it refuses.
 */
export function orderRepositories(
  reachable: readonly ReachableRepository[],
  recents: readonly string[]
): ReachableRepository[] {
  const ordered: ReachableRepository[] = [];
  const seen = new Set<string>();
  const add = (repository: ReachableRepository) => {
    const key = repository.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(repository);
  };
  for (const url of recents) {
    add(
      reachable.find((repository) => sameRepository(repository.url, url)) ?? {
        url,
      }
    );
  }
  for (const repository of reachable) add(repository);
  return ordered;
}

/**
 * Repositories whose `owner/repo` label or URL contains `search`, ignoring
 * case; every repository for blank text.
 */
export function filterRepositories(
  repositories: readonly ReachableRepository[],
  search: string
): ReachableRepository[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...repositories];
  return repositories.filter(
    (repository) =>
      repositoryLabel(repository.url).toLowerCase().includes(needle) ||
      repository.url.toLowerCase().includes(needle)
  );
}

/**
 * The branch a coder starts on for `url` when none was chosen: the
 * repository's own default branch, or `main` when it is unknown or unlisted.
 */
export function defaultBranchFor(
  repositories: readonly ReachableRepository[],
  url: string | undefined
): string {
  if (!url) return FALLBACK_BRANCH;
  return (
    repositories.find((repository) => sameRepository(repository.url, url))
      ?.defaultBranch ?? FALLBACK_BRANCH
  );
}
