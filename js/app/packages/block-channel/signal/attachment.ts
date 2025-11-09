import { createBlockSignal, createBlockStore } from '@core/block';
import { isStaticAttachmentType } from '@core/store/cacheChannelInput';
import type { Attachment } from '@service-comms/generated/models/attachment';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { useUserId } from '@service-gql/client';
import { isItemType } from '@service-storage/client';
import { channelStore } from './channel';

export const isDraggingOverChannelSignal = createBlockSignal(false);
export const isValidChannelDragSignal = createBlockSignal(true);

export const messageAttachmentsStore = createBlockStore<
  Record<string, Attachment[]>
>({});

// NOTE (seamus) : we briefly sent a few attachments on dev with block names
// instead of itemTypes as the entity type. This breaks the item preview api
// in a hard to predict way - just filter them here.
function isSafeAttachment(attachment: Attachment) {
  if (isStaticAttachmentType(attachment.entity_type)) return true;
  if (isItemType(attachment.entity_type)) return true;
  return false;
}

export function initializeAttachments(attachments: Attachment[]) {
  const setAttachmentsStore = messageAttachmentsStore.set;
  const safeAttachments = attachments.filter(isSafeAttachment);
  setAttachmentsStore('all', safeAttachments);
  const grouped = safeAttachments.reduce(
    (acc, item) => {
      const id = item.message_id;
      if (!acc[id]) {
        acc[id] = [];
      }
      acc[id].push(item);
      return acc;
    },
    {} as Record<string, Attachment[]>
  );
  setAttachmentsStore(grouped);
}

export function addAttachmentToMessage(attachment: Attachment) {
  const setAttachmentsStore = messageAttachmentsStore.set;
  setAttachmentsStore(attachment.message_id, (prev) => [
    ...(prev ?? []),
    attachment,
  ]);
}

createConnectionBlockWebsocketEffect((msg) => {
  if (msg.type === 'comms_attachment') {
    const userId_ = useUserId();
    const userId = userId_();
    const channel = channelStore.get;
    const channelId = channel?.channel?.id;
    if (!channelId || !userId) return;
    let value = JSON.parse(msg.data as any);

    const { channel_id: targetChannelId, attachments } = value;

    if (targetChannelId === channelId) {
      for (const attachment of attachments) {
        addAttachmentToMessage(attachment);
      }
    }
  }
});
