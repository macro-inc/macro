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
