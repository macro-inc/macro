import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type { EntityItem } from '@core/context/quickAccess/types';
import type { EmailEntity } from '@entity';
import {
  type CacheHost,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import { EmailQuickAccessFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import { localDraftEntities } from './local-draft-entities';

/** Materialize cached thread hits only; matching uses the projection's subject/sender text. */
export async function materializeCachedEmailItems(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<EntityItem<EmailEntity>[]> {
  const emails = new Map(
    documents
      .filter(
        (document) =>
          document.bucket === 'email' &&
          document.recordKey.startsWith('GraphqlSoupEmailThread:')
      )
      .map((document) => [document.recordKey, document])
  );
  if (!emails.size) return [];
  const records = await readRecordsByKeys(
    host,
    selectRecords(EmailQuickAccessFieldsFragmentDoc),
    [...emails.keys()]
  );
  return records.records.flatMap(({ recordKey, record }) => {
    const document = emails.get(recordKey);
    if (!document || record.__typename !== 'GraphqlSoupEmailThread') return [];
    return [
      {
        id: record.id,
        kind: 'entity',
        bucket: 'email',
        searchText: document.searchText,
        sortTimestamp: document.timestampMs,
        timestamps: {
          viewedAt: record.viewedAt,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt,
        },
        data: {
          type: 'email',
          id: record.id,
          name: record.name ?? '',
          ownerId: record.ownerId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          viewedAt: record.viewedAt,
          senderName: record.senderName ?? undefined,
          senderEmail: record.senderEmail ?? undefined,
          linkId: record.linkId,
          isRead: record.isRead,
          isDraft: record.isDraft,
          isImportant: record.isImportant,
          done: !record.inboxVisible,
        },
      },
    ];
  });
}

/** Unsynced working copies have no normalized thread/search record yet. */
export function localDraftQuickAccessItems(
  drafts: readonly LocalDraft[]
): EntityItem<EmailEntity>[] {
  return localDraftEntities(drafts).map((email) => ({
    id: email.id,
    kind: 'entity',
    bucket: 'email',
    searchText: [email.name, email.senderEmail].filter(Boolean).join(' '),
    sortTimestamp: new Date(email.updatedAt ?? 0).getTime(),
    timestamps: { updatedAt: email.updatedAt, createdAt: email.createdAt },
    data: email,
  }));
}
