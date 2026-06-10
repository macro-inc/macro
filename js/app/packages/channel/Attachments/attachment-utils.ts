import type { SplitContent } from '@app/component/split-layout/layoutManager';
import { getChannelParams } from '@channel/Channel/link';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import { stringToItemType } from '@service-storage/client';
import type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
import { match } from 'ts-pattern';

/** size-23 = 92px */
export const THUMB_SIZE = 92;
const THUMB_GAP = 6;

const NIL_ID = '00000000-0000-0000-0000-000000000000';

export function itemsPerRow(containerWidth: number): number {
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((containerWidth + THUMB_GAP) / (THUMB_SIZE + THUMB_GAP))
  );
}

/**
 * Build soup query filters that fetch only the given entity IDs,
 * grouped by type. Unused entity types are zeroed out with NIL_ID
 * so they return nothing instead of everything.
 */
export function buildAttachmentEntityFilters(
  attachments: ApiChannelAttachment[]
) {
  const documentIds: string[] = [];
  const emailIds: string[] = [];
  const chatIds: string[] = [];
  const channelIds: string[] = [];
  const projectIds: string[] = [];
  const callIds: string[] = [];

  for (const a of attachments) {
    const itemType = stringToItemType(a.entity_type);
    switch (itemType) {
      case 'document':
        documentIds.push(a.entity_id);
        break;
      case 'email':
        emailIds.push(a.entity_id);
        break;
      case 'chat':
        chatIds.push(a.entity_id);
        break;
      case 'channel':
        channelIds.push(a.entity_id);
        break;
      case 'project':
        projectIds.push(a.entity_id);
        break;
      case 'call':
        callIds.push(a.entity_id);
        break;
    }
  }

  return {
    document_filters: {
      document_ids: documentIds.length > 0 ? documentIds : [NIL_ID],
    },
    email_filters: {
      email_thread_ids: emailIds.length > 0 ? emailIds : [NIL_ID],
    },
    chat_filters: { chat_ids: chatIds.length > 0 ? chatIds : [NIL_ID] },
    channel_filters: {
      channel_ids: channelIds.length > 0 ? channelIds : [NIL_ID],
    },
    project_filters: {
      project_ids: projectIds.length > 0 ? projectIds : [NIL_ID],
    },
    call_filters: {
      call_ids: callIds.length > 0 ? callIds : [NIL_ID],
    },
    // Attachments are never crm companies; exclude them.
    crm_company_filters: { company_ids: [NIL_ID] },
  };
}

export function getEntityClickContent(entity: EntityData): SplitContent {
  return match(entity)
    .with({ type: 'document' }, (e) => ({
      type: fileTypeToBlockName(e.subType?.type ?? e.fileType),
      id: e.id,
    }))
    .with({ type: 'chat' }, (e) => ({ type: 'chat' as const, id: e.id }))
    .with({ type: 'email' }, (e) => ({ type: 'email' as const, id: e.id }))
    .with({ type: 'channel' }, (e) => ({
      type: 'channel' as const,
      id: e.id,
    }))
    .with({ type: 'project' }, (e) => ({
      type: 'project' as const,
      id: e.id,
    }))
    .with({ type: 'channel_message' }, (e) => ({
      type: 'channel' as const,
      id: e.channelId,
      params: getChannelParams(e.messageId, e.threadId),
    }))
    .with({ type: 'call' }, (e) => ({
      type: 'call' as const,
      id: e.id,
    }))
    .with({ type: 'automation' }, (e) => ({
      type: 'automation' as const,
      id: e.id,
    }))
    .with({ type: 'foreign' }, () => {
      throw new Error('foreign entities do not support channel attachments');
    })
    .with({ type: 'crm_company' }, () => {
      throw new Error('crm companies are not openable as attachments');
    })
    .with({ type: 'crm_contact' }, () => {
      throw new Error('crm contacts are not openable as attachments');
    })
    .exhaustive();
}
