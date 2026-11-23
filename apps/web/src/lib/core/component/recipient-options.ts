import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import { recipientMatchRank } from '@core/util/recipient-match-rank';
import { match, P } from 'ts-pattern';

export function getRecipientOptionEmail(
  option: CombinedRecipientItem
): string | undefined {
  return match(option)
    .with(
      { kind: P.union('user', 'contact', 'custom') },
      ({ data }) => data.email
    )
    .with({ kind: P.union('channel', 'agent') }, () => undefined)
    .exhaustive();
}

export function getRecipientOptionName(option: CombinedRecipientItem) {
  return match(option)
    .with({ kind: 'user' }, ({ data }) =>
      data.name && data.name !== data.email ? data.name : undefined
    )
    .with(
      { kind: P.union('channel', 'agent', 'contact') },
      ({ data }) => data.name
    )
    .with({ kind: 'custom' }, () => undefined)
    .exhaustive();
}

export function getRecipientOptionValue(option: CombinedRecipientItem) {
  return match(option)
    .with({ kind: 'user' }, ({ data }) => `user-${data.id}`)
    .with({ kind: 'channel' }, ({ data }) => `channel-${data.id}`)
    .with({ kind: 'agent' }, ({ data }) => `agent-${data.id}`)
    .with({ kind: 'contact' }, ({ data }) => `contact-${data.email}`)
    .with({ kind: 'custom' }, ({ data }) => `current-user-input-${data.email}`)
    .exhaustive();
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
  const name = getRecipientOptionName(option);
  const email = getRecipientOptionEmail(option);
  return match(option)
    .with({ kind: P.union('user', 'contact') }, () =>
      name ? `${name} ${email}` : (email ?? '')
    )
    .with({ kind: 'channel' }, ({ data }) => data.name ?? '')
    .with({ kind: 'agent' }, ({ data }) =>
      [data.name, data.handle, data.description].filter(Boolean).join(' ')
    )
    .with({ kind: 'custom' }, ({ data }) => data.email)
    .exhaustive();
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
  query: string
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return found;
  return found
    .map((option) => ({
      option,
      rank: recipientMatchRank(
        getRecipientOptionTextValue(option),
        getRecipientOptionEmail(option),
        normalized
      ),
    }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ option }) => option);
}
