import type { AttentionFeedShape } from '@queries/attention-feed/attention-feed-types';
import type {
  WorkFeedEntryFieldsFragment,
  WorkFeedPatchFieldsFragment,
  WorkFeedQuery,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

/** How Home's work feed documents fit the shared attention feed client. */
export const workFeedShape: AttentionFeedShape<
  WorkFeedQuery,
  WorkFeedEntryFieldsFragment,
  WorkFeedPatchFieldsFragment
> = {
  key: (entry) => entry.item.id,
  sortAt: (entry) => entry.sortAt,
  change: (patch) =>
    match(patch)
      .returnType<ReturnType<typeof workFeedShape.change>>()
      .with({ __typename: 'WorkFeedEntryUpserted' }, ({ entry }) => ({
        kind: 'upserted',
        entry,
      }))
      .with({ __typename: 'WorkFeedEntryRemoved' }, ({ itemId }) => ({
        kind: 'removed',
        key: itemId,
      }))
      .with({ __typename: 'WorkFeedInvalidated' }, () => ({
        kind: 'invalidated',
      }))
      // A change this build does not know can only be caught up by a read.
      .exhaustive(() => ({ kind: 'invalidated' })),
  entries: (page) => page.user.workFeed.entries,
  withEntries: (page, entries) => ({
    ...page,
    user: { ...page.user, workFeed: { ...page.user.workFeed, entries } },
  }),
};
