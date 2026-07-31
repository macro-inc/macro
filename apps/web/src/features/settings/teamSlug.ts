export const TEAM_SLUG_MAX_LENGTH = 20;

export const TEAM_SLUG_ALLOWED_INPUT_REGEX: RegExp = /^[A-Za-z_\- \t\n\f\r]*$/;

export const TEAM_SLUG_NORMALIZED_REGEX: RegExp = /^[A-Z]+(_[A-Z]+)*$/;

const ASCII_LETTER_REGEX: RegExp = /^[A-Za-z]$/;

function isAsciiLetter(character: string): boolean {
  return ASCII_LETTER_REGEX.test(character);
}

function isTeamSlugSeparator(character: string): boolean {
  return (
    character === '_' ||
    character === '-' ||
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\f' ||
    character === '\r'
  );
}

export function normalizeTeamSlugInput(input: string): string {
  let normalized = '';
  let lastWasSeparator = false;

  for (const character of input) {
    if (isTeamSlugSeparator(character)) {
      if (normalized !== '' && !lastWasSeparator) {
        normalized += '_';
      }
      lastWasSeparator = true;
      continue;
    }

    if (isAsciiLetter(character)) {
      normalized += character.toUpperCase();
    } else {
      normalized += character;
    }
    lastWasSeparator = false;
  }

  while (normalized.endsWith('_')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function getTeamSlugError(input: string): string | undefined {
  if (!TEAM_SLUG_ALLOWED_INPUT_REGEX.test(input)) {
    return 'team slug may only contain ASCII letters, spaces, hyphens, and underscores';
  }

  const normalized = normalizeTeamSlugInput(input);

  if (normalized === '' || !TEAM_SLUG_NORMALIZED_REGEX.test(normalized)) {
    return 'team slug cannot be empty';
  }

  if (normalized.length > TEAM_SLUG_MAX_LENGTH) {
    return `team slug cannot be longer than ${TEAM_SLUG_MAX_LENGTH} characters`;
  }

  return undefined;
}

/** Builds the target URL template GitHub requires for numeric autolinks. */
export function buildTeamTaskAutolinkTargetUrl(
  teamSlug: string,
  webOrigin: string
): string {
  return `${webOrigin.replace(/\/$/, '')}/app/task-slug/${teamSlug}-<num>`;
}

const TEAM_TASK_NUMBER_REGEX: RegExp = /^\d{1,9}$/;

/**
 * Mirrors the backend team-task slug parser: a `-`-separated prefix with no
 * empty segments and a positive task number (digits capped at 9 to stay
 * inside an i32), so slugs the backend would reject with 400 never leave the
 * client.
 */
export function isValidTeamTaskSlug(slug: string): boolean {
  const separatorIndex = slug.lastIndexOf('-');
  if (separatorIndex === -1) return false;

  const prefix = slug.slice(0, separatorIndex);
  const number = slug.slice(separatorIndex + 1);
  if (prefix === '' || prefix.split('-').some((segment) => segment === '')) {
    return false;
  }

  return TEAM_TASK_NUMBER_REGEX.test(number) && Number(number) > 0;
}
