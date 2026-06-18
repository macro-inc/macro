import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { EntityData } from '@entity';
import {
  type ChannelAttachmentsData,
  flattenAttachments,
  useChannelDocumentAttachmentsQuery,
} from '@queries/channel/channel-attachments';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { stringToItemType } from '@service-storage/client';
import type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
import { createMemo } from 'solid-js';
import {
  AttachmentEntityList,
  type AttachmentEntityListRow,
} from './AttachmentEntityList';
import { getEntityClickContent } from './attachment-utils';

/**
 * Scope a soup query to exactly the attachment entities. `defineQueryFilters`
 * NIL-fills every entity type we don't reference, so soup never fans out to
 * crm companies or foreign entities (which it would otherwise fetch unfiltered).
 */
function attachmentSoupAst(attachments: ApiChannelAttachment[]) {
  const documentId: string[] = [];
  const threadId: string[] = [];
  const chatId: string[] = [];
  const channelId: string[] = [];
  const folderId: string[] = [];
  const callId: string[] = [];

  for (const a of attachments) {
    switch (stringToItemType(a.entity_type)) {
      case 'document':
        documentId.push(a.entity_id);
        break;
      case 'email':
        threadId.push(a.entity_id);
        break;
      case 'chat':
        chatId.push(a.entity_id);
        break;
      case 'channel':
        channelId.push(a.entity_id);
        break;
      case 'project':
        folderId.push(a.entity_id);
        break;
      case 'call':
        callId.push(a.entity_id);
        break;
    }
  }

  const include: NonNullable<Query['include']> = {};
  if (documentId.length) include.documentId = documentId;
  if (threadId.length) include.threadId = threadId;
  if (chatId.length) include.chatId = chatId;
  if (channelId.length) include.channelId = channelId;
  if (folderId.length) include.folderId = folderId;
  if (callId.length) include.callId = callId;

  return compileToAst(queryStateFrom(defineQueryFilters({ include })));
}

export function ChannelAttachmentEntitySection(props: { channelId: string }) {
  const attachmentsQuery = useChannelDocumentAttachmentsQuery(
    () => props.channelId
  );

  const documentAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.data as ChannelAttachmentsData | undefined
    )
  );

  const soupQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 500 },
      body: attachmentSoupAst(documentAttachments()),
    }),
    () => ({ enabled: documentAttachments().length > 0 })
  );

  const attachmentByEntityId = createMemo(() => {
    const map = new Map<string, ApiChannelAttachment>();
    for (const attachment of documentAttachments()) {
      map.set(attachment.entity_id, attachment);
    }
    return map;
  });

  const { replaceOrInsertSplit } = useSplitLayout();
  const handleEntityClick = (entity: EntityData) =>
    replaceOrInsertSplit(getEntityClickContent(entity));

  const rows = createMemo<AttachmentEntityListRow[]>(() => {
    const entities = soupQuery.data?.entities ?? [];
    const lookup = attachmentByEntityId();

    return [...entities]
      .sort((a, b) => {
        const aTime = lookup.get(a.id)?.created_at ?? '';
        const bTime = lookup.get(b.id)?.created_at ?? '';
        return bTime.localeCompare(aTime);
      })
      .map((entity) => {
        const attachment = lookup.get(entity.id);
        return {
          entity,
          timestamp: attachment?.created_at,
          senderId: attachment?.sender_id,
          onClick: () => handleEntityClick(entity),
        };
      });
  });

  return (
    <AttachmentEntityList
      rows={rows()}
      hasNextPage={!!attachmentsQuery.hasNextPage}
      isFetchingNextPage={attachmentsQuery.isFetchingNextPage}
      onLoadMore={() => attachmentsQuery.fetchNextPage()}
    />
  );
}
