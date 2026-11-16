import { normalizeNameText } from '@core/util/name-match-score';
import * as EmailValidator from 'email-validator';

export type Recipient = {
  id: string;
  label: string;
  email?: string;
  kind: 'user' | 'channel';
  /** A literal address, not evidence of a known personal-directory identity. */
  external?: true;
};

/** Complete evidence for one term. Undefined means unavailable/incomplete. */
export type RecipientLookup = (
  term: string
) => readonly Recipient[] | undefined;
export type RecipientChoices = readonly Recipient[] | RecipientLookup;

export function recipientReferenceTerm(term: string): string {
  const trimmed = term.trim();
  if (
    trimmed.toLowerCase().startsWith('macro|') ||
    EmailValidator.validate(trimmed)
  )
    return trimmed.toLowerCase();
  return normalizeNameText(trimmed).replace(/^[@#]/, '');
}

/** Channel IDs are explicit choices. Names still need complete people evidence
 * so a known channel cannot hide an ambiguous person with the same name. */
export function messageRecipientChoices(
  term: string,
  people: RecipientLookup,
  channels: readonly Recipient[]
): readonly Recipient[] | undefined {
  const identity = channels.filter(
    (channel) => channel.id.toLowerCase() === term
  );
  if (identity.length) return identity;
  const users = people(term);
  return users ? [...users, ...channels] : undefined;
}

/** Keep legacy free-form input, but encode model/selection boundaries when needed. */
export function formatRecipientTerms(terms: readonly string[]): string {
  return terms.some((term) => /[,;\n]|^\s*\[/.test(term))
    ? JSON.stringify(terms)
    : terms.join(', ');
}

export function recipientTerms(text: string): string[] {
  if (text.trimStart().startsWith('[')) {
    try {
      const value: unknown = JSON.parse(text);
      if (
        Array.isArray(value) &&
        value.every((part: unknown) => typeof part === 'string')
      )
        return value.map((part) => part.trim()).filter(Boolean);
    } catch {
      /* A manually typed bracket is still free-form input. */
    }
  }
  return text
    .split(/[,;\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Only exact names, addresses, IDs or a unique first name can resolve automatically. */
export function resolveRecipients(
  text: string,
  options: RecipientChoices,
  allowExternal: boolean
): { recipients: Recipient[]; unresolved: string[] } {
  return resolveRecipientTerms(recipientTerms(text), options, allowExternal);
}

/** Model-provided lists already have boundaries; do not split names a second time. */
export function resolveRecipientTerms(
  terms: readonly string[],
  options: RecipientChoices,
  allowExternal: boolean
): { recipients: Recipient[]; unresolved: string[] } {
  const recipients: Recipient[] = [];
  const unresolved: string[] = [];
  for (const term of terms.map((term) => term.trim()).filter(Boolean)) {
    const query = recipientReferenceTerm(term);
    const choices = typeof options === 'function' ? options(query) : options;
    const identity =
      choices?.filter((person) =>
        [person.id, person.email].some(
          (value) => value?.toLowerCase() === query
        )
      ) ?? [];
    if (identity.length === 1) {
      recipients.push(identity[0]);
      continue;
    }
    const address =
      !query.startsWith('macro|') && EmailValidator.validate(term);
    if (address) {
      // Explicit addresses cannot be redirected by someone else's display name.
      if (!identity.length && allowExternal)
        recipients.push({
          id: query,
          email: term,
          label: term,
          kind: 'user',
          external: true,
        });
      else unresolved.push(term);
      continue;
    }
    if (!choices || identity.length > 1 || query.startsWith('macro|')) {
      unresolved.push(term);
      continue;
    }
    const exact = choices.filter(
      (person) => normalizeNameText(person.label) === query
    );
    const matches = exact.length
      ? exact
      : choices.filter(
          (person) => normalizeNameText(person.label).split(' ')[0] === query
        );
    if (matches.length === 1) recipients.push(matches[0]);
    else unresolved.push(term);
  }
  return {
    recipients: [...new Map(recipients.map((p) => [p.id, p])).values()],
    unresolved,
  };
}
