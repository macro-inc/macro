import { selectRecords } from '@graphql-cache/exchange/record-selection';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { MailItemFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '@service-storage/graphql-soup';
import { expect, it } from 'vitest';
import { readSoupPage } from './read-soup-page';

it('does not restore an inbox row from its old preview after a trash response', async () => {
  const timestamp = '2026-01-01T00:00:00Z';
  const snapshot: GraphqlSoupItem = {
    __typename: 'GraphqlSoupEmailThread',
    id: 'thread',
    entityType: 'EMAIL_THREAD',
    displayName: 'Invoice',
    emailName: 'Invoice',
    cacheProjection: null,
    isFavorited: false,
    frecencyScore: null,
    providerId: null,
    ownerId: 'viewer',
    linkId: 'inbox',
    inboxVisible: true,
    hasReceivedMail: true,
    latestInboundMessageTs: timestamp,
    latestOutboundMessageTs: null,
    latestNonSpamMessageTs: timestamp,
    reminderReturnedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    viewedAt: null,
    snippet: null,
    senderEmail: null,
    senderName: null,
    senderPhotoUrl: null,
    isRead: true,
    isDraft: false,
    isImportant: false,
    isSignal: false,
    projectId: null,
    mailAllPreview: null,
    mailDraftPreview: null,
    mailSentPreview: null,
    mailDraftState: null,
    participants: [],
    attachments: [],
    labels: [],
    properties: [],
    notifications: [],
  };
  const key = 'GraphqlSoupEmailThread:thread';
  const revision = parseCacheRevision('1');
  const host = {
    currentRevision: async () => revision,
    readRecordsByKeys: async () => ({
      revision,
      records: [{ recordKey: key, record: snapshot }],
    }),
  };

  const result = await readSoupPage(host, {
    page: {
      kind: 'mail-page',
      revision,
      keys: [key],
      retainedKeys: [],
      nextCursor: null,
      sortTimestamps: [timestamp],
      optimistic: false,
    },
    select: selectRecords(MailItemFieldsFragmentDoc),
    baseline: [snapshot],
    mailView: 'INBOX',
  });

  expect(result).toEqual({ kind: 'ready', revision, records: [] });
});
