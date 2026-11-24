import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';

export type LinkValueError = { kind: 'invalid' } | { kind: 'duplicate' };

/** A typed link without a scheme gets `https://`; blank input stays blank. */
export function normalizeLinkInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * The links a Link property holds once the typed input is added: a property
 * that takes several links appends it, any other replaces its link.
 */
export function addLinkValue(
  links: string[],
  input: string,
  isMultiSelect: boolean
): Result<string[], LinkValueError> {
  const url = normalizeLinkInput(input);
  if (!isValidUrl(url)) return err({ kind: 'invalid' });
  if (links.includes(url)) return err({ kind: 'duplicate' });
  return ok(isMultiSelect ? [...links, url] : [url]);
}

/** The links left once one is removed; removing the last clears the value. */
export function removeLinkValue(links: string[], url: string): string[] | null {
  const remaining = links.filter((link) => link !== url);
  return remaining.length > 0 ? remaining : null;
}

export function linkValueErrorMessage(error: LinkValueError): string {
  return match(error)
    .with({ kind: 'invalid' }, () => 'Please enter a valid URL')
    .with({ kind: 'duplicate' }, () => 'This URL has already been added')
    .exhaustive();
}
