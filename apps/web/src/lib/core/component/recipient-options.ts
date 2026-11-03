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

// These addresses remain available as explicitly typed custom recipients.
export function isAutomatedAddress(email: string) {
  const local = email.split('@')[0];
  return (
    /^(?:notifications|mailer-daemon|postmaster|bounce)(?:[+._-]|$)/i.test(
      local
    ) || /(?:no[._-]?reply|do[._-]?not[._-]?reply)/i.test(local)
  );
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
