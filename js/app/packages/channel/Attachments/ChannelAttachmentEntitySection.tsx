import { createMemo } from 'solid-js';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { EntityData } from '@entity';
import type { ApiChannelAttachment } from '@service-comms/client';
import { useSoupItemsQuery } from '@queries/soup/items';
import {
  flattenAttachments,
  useChannelDocumentAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import {
  buildAttachmentEntityFilters,
  getEntityClickContent,
} from './attachment-utils';
import {
  AttachmentEntityList,
  type AttachmentEntityListRow,
} from './AttachmentEntityList';

export function ChannelAttachmentEntitySection(props: { channelId: string }) {
  const attachmentsQuery = useChannelDocumentAttachmentsQuery(
    () => props.channelId
  );

  const documentAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.data as ChannelAttachmentsData | undefined
    )
  );

  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 500 },
      body: buildAttachmentEntityFilters(
        documentAttachments(),
        props.channelId
      ),
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
    const entities = soupQuery.data ?? [];
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
