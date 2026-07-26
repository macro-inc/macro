import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant';
import type { ChatAttachmentMention } from '@core/component/AI/util/chatAttachmentMention';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityDragData, EntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';
import { match, P } from 'ts-pattern';

/**
 * Hook to handle entity drag-and-drop for chat attachments.
 * Creates a droppable zone and handles converting dropped entities to attachments.
 *
 * @param droppableId - Unique ID for the droppable zone
 * @param onAttach - Inserts the dropped entity into the chat composer
 * @returns Object with droppable directive and isDraggingOver signal
 */
export function useEntityDropAttachment(
  droppableId: string,
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
    if (!dragData || dragData.dragType !== 'entity') return;
    return dragData as EntityDragData;
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

  onDragEnd((event: EntityDragEvent) => {
    if (!event.droppable) return;
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

    const mention: ChatAttachmentMention | undefined = match(entityType)
      .with('document', () => ({
        documentId: entityId,
        documentName: data.name,
        blockName,
      }))
      .with('project', () => ({
        documentId: entityId,
        documentName: data.name,
        blockName: 'project',
      }))
      .with(P.union('channel', 'channel_message', 'channel_thread'), () => {
        const channelId =
          'channelId' in data && typeof data.channelId === 'string'
            ? data.channelId
            : entityId;
        return {
          documentId: channelId,
          documentName: data.name,
          blockName: 'channel',
          channelType: 'channelType' in data ? data.channelType : undefined,
        };
      })
      .with('email', () => ({
        documentId: entityId,
        documentName: data.name,
        blockName: 'email',
      }))
      .with('chat', () => undefined)
      .with('call', () => undefined)
      .with('automation', () => undefined)
      .with('foreign', () => undefined)
      .with('crm_company', () => undefined)
      .with('crm_contact', () => undefined)
      .exhaustive();

    if (mention) {
      onAttach(mention);
    }
  });

  return { droppable, isDraggingOver };
}
