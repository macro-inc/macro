import type { AttentionFeedShape } from '@queries/attention-feed/attention-feed-types';
import type {
  NotificationInboxEntryFieldsFragment,
  NotificationInboxPatchFieldsFragment,
  NotificationInboxQuery,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

/** How the inbox's documents fit the shared attention feed client. */
export const notificationInboxShape: AttentionFeedShape<
  NotificationInboxQuery,
  NotificationInboxEntryFieldsFragment,
  NotificationInboxPatchFieldsFragment
> = {
  key: (entry) => entry.groupId,
  sortAt: (entry) => entry.sortAt,
  change: (patch) =>
    match(patch)
      .returnType<ReturnType<typeof notificationInboxShape.change>>()
      .with({ __typename: 'NotificationInboxEntryUpserted' }, ({ entry }) => ({
        kind: 'upserted',
        entry,
      }))
      .with({ __typename: 'NotificationInboxEntryRemoved' }, ({ groupId }) => ({
        kind: 'removed',
        key: groupId,
      }))
      .with({ __typename: 'NotificationInboxInvalidated' }, () => ({
        kind: 'invalidated',
      }))
      // A change this build does not know can only be caught up by a read.
      .exhaustive(() => ({ kind: 'invalidated' })),
  entries: (page) => page.user.notificationInbox.entries,
  withEntries: (page, entries) => ({
    ...page,
    user: {
      ...page.user,
      notificationInbox: { ...page.user.notificationInbox, entries },
    },
  }),
};
