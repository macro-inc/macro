import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  type RecipientOutcome,
  type ShareNotice,
  type ShareOutcome,
  type ShareTarget,
} from '../core/delivery-plan';
import {
  type ChannelAccessError,
  itemKey,
  type ShareItem,
} from '../core/share-item';

export function ShareNotices(props: { notices: readonly ShareNotice[] }) {
  return (
    <Show when={props.notices.length > 0}>
      <ul class="space-y-1 text-sm text-ink-muted">
        <For each={props.notices}>
          {(notice) => <li>{noticeText(notice)}</li>}
        </For>
      </ul>
    </Show>
  );
}

export function ShareReport(props: {
  outcome: ShareOutcome;
  recipientName: (target: ShareTarget) => string;
}) {
  return (
    <div role="status" class="space-y-2">
      <p class="text-sm text-ink">{headline(props.outcome)}</p>
      <ul class="space-y-1 text-sm text-ink-muted">
        <For each={props.outcome.recipients}>
          {(recipient) => (
            <For
              each={recipientLines(
                recipient,
                props.recipientName(recipient.target)
              )}
            >
              {(line) => <li>{line}</li>}
            </For>
          )}
        </For>
      </ul>
    </div>
  );
}

function noticeText(notice: ShareNotice): string {
  return match(notice)
    .with({ t: 'left-out' }, ({ items }) =>
      items.length === 1
        ? `${itemNames(items)} will be left out, because only its owner can share it.`
        : `${itemNames(items)} will be left out, because only their owners can share them.`
    )
    .with({ t: 'not-owner' }, ({ items }) =>
      items.length === 1
        ? `You don't own ${itemNames(items)}, so recipients get view access through the message. Only its owner can grant more.`
        : `You don't own ${itemNames(items)}, so recipients get view access through the message. Only their owners can grant more.`
    )
    .with(
      { t: 'capped' },
      ({ items, level }) =>
        `${itemNames(items)} can be shared with ${level} access at most.`
    )
    .with(
      { t: 'split' },
      ({ messagesPerRecipient }) =>
        `Each recipient gets ${messagesPerRecipient} messages, because a message holds up to ${MAX_ATTACHMENTS_PER_MESSAGE} items. Your message goes in the first.`
    )
    .exhaustive();
}

function headline(outcome: ShareOutcome): string {
  const missing = outcome.recipients.some(
    (recipient) => recipient.unsent.length > 0
  );
  const summary = missing
    ? 'Not every recipient got every item.'
    : 'Every recipient got every item, but some access was not updated.';
  return outcome.retryable
    ? `${summary} Retry repeats only what failed.`
    : summary;
}

const ACCESS_PROBLEM = {
  failed: 'access was not updated',
  'not-allowed': 'only the owner can change access',
  unsupported: 'access cannot be changed here',
} as const satisfies Record<ChannelAccessError, string>;

function recipientLines(recipient: RecipientOutcome, name: string): string[] {
  const unsent = new Set(recipient.unsent.map(itemKey));
  const received = recipient.accessIssues.filter(
    ({ item }) => !unsent.has(itemKey(item))
  );
  const errors = [...new Set(received.map(({ error }) => error))];
  return [
    ...(recipient.unsent.length > 0
      ? [`${name} did not get ${itemNames(recipient.unsent)}.`]
      : []),
    ...errors.map((error) => {
      const items = received
        .filter((issue) => issue.error === error)
        .map(({ item }) => item);
      return `${name} got ${itemNames(items)}, but ${ACCESS_PROBLEM[error]}.`;
    }),
  ];
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });

function itemNames(items: readonly ShareItem[]): string {
  const names = items.map((item) => item.name || 'Untitled');
  return listFormat.format(
    names.length > 3
      ? [...names.slice(0, 2), `${names.length - 2} more`]
      : names
  );
}
