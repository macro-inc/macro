import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant';
import type { Attachment, Attachments } from '@core/component/AI/types';
import type { ChatAttachmentMention } from '@core/component/AI/util/chatAttachmentMention';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isEntityDragData, isEntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';

/**
 * Hook to handle entity drag-and-drop for chat attachments.
 * Creates a droppable zone and handles converting dropped entities to attachments.
 *
 * @param droppableId - Unique ID for the droppable zone
 * @param attachments - Chat attachment state
 * @param onAttach - Inserts the dropped entity into the chat composer
 * @returns Object with droppable directive and isDraggingOver signal
 */
export function useEntityDropAttachment(
  droppableId: string,
  attachments: Attachments,
  onAttach: (mention: ChatAttachmentMention) => void
): {
  droppable: ReturnType<typeof createDroppable>;
  isDraggingOver: Accessor<boolean>;
} {
  const droppable = createDroppable(droppableId);

  const [state, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  const entityDragData = createMemo(() => {
    const draggable = state?.active.draggable;
    if (!draggable) return;
    const dragData = draggable.data;
    if (!isEntityDragData(dragData)) return;
    return dragData;
  });

  const isDraggingOver = createMemo(() => {
    const dragData = entityDragData();
    if (!dragData) return false;

    const activeDroppable = state?.active.droppable;
    if (!activeDroppable || activeDroppable.id !== droppableId) return false;

    // Check if it's a supported attachment type
    const fileType = 'fileType' in dragData ? dragData.fileType : undefined;
    const blockName = fileTypeToBlockName(fileType ?? dragData.type, true);
    return SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName);
  });

  onDragEnd((event) => {
    if (!isEntityDragEvent(event) || !event.droppable) return;
    if (event.droppable.id !== droppableId) return;

    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

    const entityId = data.id;
    const entityType = data.type;
    const fileType = 'fileType' in data ? data.fileType : undefined;

    // Determine block name and check if it's a supported attachment type
    const blockName = fileTypeToBlockName(fileType ?? entityType, true);
    if (!SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName)) {
      toast.failure('This file type cannot be attached to chat');
      return;
    }

    let attachment: Attachment | undefined;
    let mention: ChatAttachmentMention | undefined;

    if (entityType === 'document') {
      attachment = { entity_id: entityId, entity_type: 'document' };
      mention = {
        documentId: entityId,
        documentName: data.name,
        blockName,
      };
    } else if (entityType === 'project') {
      attachment = { entity_id: entityId, entity_type: 'project' };
      mention = {
        documentId: entityId,
        documentName: data.name,
        blockName: 'project',
      };
    } else if (
      entityType === 'channel' ||
      entityType === 'channel_message' ||
      entityType === 'channel_thread'
    ) {
      const channelId = 'channelId' in data ? data.channelId : entityId;
      attachment = { entity_id: channelId, entity_type: 'channel' };
      mention = {
        documentId: channelId,
        documentName: data.name,
        blockName: 'channel',
        channelType: data.channelType,
      };
    } else if (entityType === 'email') {
      attachment = { entity_id: entityId, entity_type: 'email_thread' };
      mention = {
        documentId: entityId,
        documentName: data.name,
        blockName: 'email',
      };
    }

    if (!attachment || !mention) return;
    attachments.addAttachment(attachment);
    onAttach(mention);
  });

  return { droppable, isDraggingOver };
}
