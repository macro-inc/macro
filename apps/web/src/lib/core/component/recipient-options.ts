import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import type { IUser } from '@core/user/types';
import { recipientMatchRank } from '@core/util/recipient-match-rank';
import { match, P } from 'ts-pattern';

/** What search, ranking and the option list read from an option: the text a
 * query matches, its address, and its key in the list. */
export type RecipientOptionFields = {
  text: string;
  email: string | undefined;
  value: string;
};

/** A user's name, unless it only repeats their address. */
const userName = (user: IUser) =>
  user.name && user.name !== user.email ? user.name : undefined;

/** A person matches by name, then address. */
const personText = (
  name: string | null | undefined,
  email: string | undefined
) => (name ? `${name} ${email}` : (email ?? ''));

/** Reads an option's fields in one pass. A picker over thousands of channels
 * reads them once per list instead of once per field on every keystroke. */
export function getRecipientOptionFields(
  option: CombinedRecipientItem
): RecipientOptionFields {
  return match(option)
    .with({ kind: 'user' }, ({ data }) => ({
      text: personText(userName(data), data.email),
      email: data.email,
      value: `user-${data.id}`,
    }))
    .with({ kind: 'contact' }, ({ data }) => ({
      text: personText(data.name, data.email),
      email: data.email,
      value: `contact-${data.email}`,
    }))
    .with({ kind: 'channel' }, ({ data }) => ({
      text: data.name ?? '',
      email: undefined,
      value: `channel-${data.id}`,
    }))
    .with({ kind: 'agent' }, ({ data }) => ({
      text: [data.name, data.handle, data.description]
        .filter(Boolean)
        .join(' '),
      email: undefined,
      value: `agent-${data.id}`,
    }))
    .with({ kind: 'custom' }, ({ data }) => ({
      text: data.email,
      email: data.email,
      value: `current-user-input-${data.email}`,
    }))
    .exhaustive();
}

export function getRecipientOptionEmail(
  option: CombinedRecipientItem
): string | undefined {
  return getRecipientOptionFields(option).email;
}

export function getRecipientOptionName(option: CombinedRecipientItem) {
  return match(option)
    .with({ kind: 'user' }, ({ data }) => userName(data))
    .with(
      { kind: P.union('channel', 'agent', 'contact') },
      ({ data }) => data.name
    )
    .with({ kind: 'custom' }, () => undefined)
    .exhaustive();
}

export function getRecipientOptionValue(option: CombinedRecipientItem) {
  return getRecipientOptionFields(option).value;
}

export function getRecipientOptionLabel(option: CombinedRecipientItem) {
  return match(option)
    .with(
      { kind: P.union('user', 'contact', 'custom') },
      ({ data }) => data.email
    )
    .with({ kind: 'channel' }, ({ data }) => data.id)
    .with({ kind: 'agent' }, ({ data }) => data.name)
    .exhaustive();
}

export function getRecipientOptionTextValue(option: CombinedRecipientItem) {
  return getRecipientOptionFields(option).text;
}

type RecipientIdentity = {
  kind: CombinedRecipientItem['kind'];
  id: string;
  data: { id: string; email?: string };
};

function recipientIdentity(option: RecipientIdentity) {
  const email = option.data.email;
  return email &&
    (option.kind === 'user' ||
      option.kind === 'contact' ||
      option.kind === 'custom')
    ? `email:${email.trim().toLowerCase()}`
    : `${option.kind}:${option.id}`;
}

/** Scoped thread addresses and directory users can represent the same person.
 * Preserve the caller's selected value rather than changing a chip's kind. */
export function uniqueRecipientMatches<T extends RecipientIdentity>(
  options: readonly T[],
  selected: readonly T[] = []
): T[] {
  const preferred = new Map(
    selected.map((item) => [recipientIdentity(item), item])
  );
  const seen = new Set<string>();
  return options.flatMap((item) => {
    const key = recipientIdentity(item);
    if (seen.has(key)) return [];
    seen.add(key);
    return [preferred.get(key) ?? item];
  });
}

export function rankRecipientMatches<T extends CombinedRecipientItem>(
  found: T[],
  query: string,
  fields: (option: T) => RecipientOptionFields = getRecipientOptionFields
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return found;
  return found
    .map((option) => {
      const { text, email } = fields(option);
      return { option, rank: recipientMatchRank(text, email, normalized) };
    })
    .sort((a, b) => b.rank - a.rank)
    .map(({ option }) => option);
}
