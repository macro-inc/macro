import { formatLocale, t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import { draftFromStack, type Stack, type StackKind } from '../core/stack';

export const stackKindLabel = (kind: StackKind) =>
  match(kind)
    .with('newMessage', () => t('notificationStacks.kindNewMessage'))
    .with('mention', () => t('notificationStacks.kindMention'))
    .with('reply', () => t('notificationStacks.kindReply'))
    .with('reaction', () => t('notificationStacks.kindReaction'))
    .with('documentMention', () => t('notificationStacks.kindDocumentMention'))
    .with('comment', () => t('notificationStacks.kindComment'))
    .exhaustive();

const list = (items: string[]) =>
  new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(items);

/**
 * One line saying what a stack captures and what it lets through, such as
 * "Channels named “support” · New messages · Lets Mentions and Replies
 * through". Each part is its own phrase, so no sentence is assembled.
 */
export function describeStack(stack: Stack): string {
  const draft = draftFromStack(stack);
  if (!draft) return t('notificationStacks.summaryCustomRules');

  const count = (type: 'channel' | 'document' | 'folder' | 'project') =>
    draft.sources.filter((source) => source.type === type).length;
  const counted = (
    amount: number,
    phrase: (count: number) => string
  ): string[] => (amount > 0 ? [phrase(amount)] : []);

  const places = [
    ...draft.sources.flatMap((source) =>
      source.type === 'channelNameContains'
        ? [t('notificationStacks.summaryNamed', { text: source.text })]
        : []
    ),
    ...counted(count('channel'), (amount) =>
      t('notificationStacks.summaryChannels', { count: amount })
    ),
    ...counted(count('document'), (amount) =>
      t('notificationStacks.summaryDocuments', { count: amount })
    ),
    ...counted(count('folder'), (amount) =>
      t('notificationStacks.summaryFolders', { count: amount })
    ),
    ...counted(count('project'), (amount) =>
      t('notificationStacks.summaryProjects', { count: amount })
    ),
    ...counted(draft.senders.length, (amount) =>
      t('notificationStacks.summaryPeople', { count: amount })
    ),
  ];
  const released = [
    ...(draft.releaseMentions ? [stackKindLabel('mention')] : []),
    ...(draft.releaseReplies ? [stackKindLabel('reply')] : []),
  ];

  return [
    places.length > 0
      ? list(places)
      : t('notificationStacks.summaryEverywhere'),
    ...(draft.kinds.length > 0 ? [list(draft.kinds.map(stackKindLabel))] : []),
    ...(released.length > 0
      ? [t('notificationStacks.summaryReleases', { kinds: list(released) })]
      : []),
  ].join(' · ');
}
