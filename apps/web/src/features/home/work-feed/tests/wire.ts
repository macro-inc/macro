import type {
  WorkFeedEntryFieldsFragment,
  WorkFeedPatchFieldsFragment,
} from '@service-storage/graphql/generated/graphql';

type NotificationFixture = {
  id: string;
  createdAt: string;
  state?: 'UNSEEN' | 'SEEN' | 'DONE';
};

type EntryFixture = {
  docId: string;
  sortAt: string;
  revision?: string;
  primaryReason?: 'ATTENTION' | 'OWN_WORK';
  attentionAt?: string | null;
  touchedAt?: string | null;
  state?: 'UNSEEN' | 'SEEN' | 'DONE';
  stacks?: NotificationFixture[][];
};

/** A comment notification as the GraphQL fragments select it. */
export function commentNotification(
  docId: string,
  notification: NotificationFixture
) {
  return {
    id: notification.id,
    eventType: 'commented_on_document',
    entityType: 'DOCUMENT',
    entityId: docId,
    sent: true,
    state: notification.state ?? 'UNSEEN',
    createdAt: notification.createdAt,
    viewedAt: null,
    updatedAt: notification.createdAt,
    senderId: 'macro|colleague@example.com',
    metadata: {
      __typename: 'GraphqlCommentedOnDocumentMetadata',
      commentedOnDocumentDocumentName: 'Plan',
      commentedOnDocumentOwner: 'macro|viewer@example.com',
      commentedOnDocumentFileType: 'md',
      commentedOnDocumentSubType: null,
      commentedOnDocumentCommentId: notification.id,
      commentedOnDocumentThreadId: notification.id,
      commentedOnDocumentText: 'looks good',
      commentedOnDocumentSenderProfilePictureUrl: null,
    },
  };
}

/** A document work feed entry as the `WorkFeedEntryFields` fragment selects it. */
export function documentEntry(
  fixture: EntryFixture
): WorkFeedEntryFieldsFragment {
  return {
    sortAt: fixture.sortAt,
    touchedAt: fixture.touchedAt ?? null,
    revision: fixture.revision ?? `rev-${fixture.docId}`,
    primaryReason: fixture.primaryReason ?? 'ATTENTION',
    primaryStackIndex: fixture.primaryReason === 'OWN_WORK' ? null : 0,
    item: {
      id: `document:${fixture.docId}`,
      state: fixture.state ?? 'UNSEEN',
      attentionAt: fixture.attentionAt ?? null,
      unseenCount: 0,
      entity: {
        __typename: 'GraphqlSoupDocument',
        id: fixture.docId,
        entityType: 'DOCUMENT',
        displayName: 'Plan',
        documentName: 'Plan',
        ownerId: 'macro|viewer@example.com',
        fileType: 'md',
        projectId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        viewedAt: null,
        deletedAt: null,
        subType: null,
        isFavorited: false,
        frecencyScore: null,
        cacheProjection: null,
        properties: [],
      },
      stacks: (fixture.stacks ?? []).map((notifications) => ({
        kind: 'COMMENTS',
        threadId: null,
        latestAt: notifications[0]?.createdAt ?? fixture.sortAt,
        unseen: notifications.some((n) => (n.state ?? 'UNSEEN') === 'UNSEEN'),
        count: notifications.length,
        notifications: notifications.map((n) =>
          commentNotification(fixture.docId, n)
        ),
      })),
    },
  } as unknown as WorkFeedEntryFieldsFragment;
}

export function upsertedPatch(entry: WorkFeedEntryFieldsFragment) {
  return {
    __typename: 'WorkFeedEntryUpserted',
    entry,
  } as WorkFeedPatchFieldsFragment;
}

export function removedPatch(itemId: string) {
  return {
    __typename: 'WorkFeedEntryRemoved',
    itemId,
  } as WorkFeedPatchFieldsFragment;
}

export function invalidatedPatch() {
  return {
    __typename: 'WorkFeedInvalidated',
    refresh: true,
  } as WorkFeedPatchFieldsFragment;
}

export function workFeedPage(
  entries: WorkFeedEntryFieldsFragment[],
  nextCursor: string | null = null
) {
  return {
    user: { id: 'macro|viewer@example.com', workFeed: { entries, nextCursor } },
  };
}
