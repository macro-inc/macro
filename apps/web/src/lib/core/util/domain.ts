import { Result } from 'neverthrow';

/** A bare email domain: no local part, two or more labels. */
export const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const MAX_DOMAIN_LENGTH = 253;

const parseUrl = Result.fromThrowable((value: string) => new URL(value));

/**
 * The email domain someone meant by `text`, lowercased: a bare domain, an
 * address (`person@example.com`, `@example.com`), or a website
 * (`https://www.example.com/about`).
 * `undefined` when it names no domain.
 */
export function parseDomain(text: string): string | undefined {
  let candidate = text.trim().toLowerCase();
  const at = candidate.lastIndexOf('@');
  if (at >= 0) candidate = candidate.slice(at + 1);
  else if (candidate.includes('/') || candidate.startsWith('www.')) {
    const url = parseUrl(
      candidate.includes('://') ? candidate : `https://${candidate}`
    );
    if (url.isErr()) return undefined;
    candidate = url.value.hostname.replace(/^www\./, '');
  }
  candidate = candidate.replace(/\.$/, '');
  if (candidate.length > MAX_DOMAIN_LENGTH || !DOMAIN_PATTERN.test(candidate))
    return undefined;
  return candidate;
}
