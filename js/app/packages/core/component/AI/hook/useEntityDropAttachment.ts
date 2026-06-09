import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityDragData, EntityDragEvent } from '@entity';
import type { EntityType } from '@service-cognition/generated/schemas/entityType';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';
import { match, P } from 'ts-pattern';

/**
 * Hook to handle entity drag-and-drop for chat attachments.
 * Creates a droppable zone and handles converting dropped entities to attachments.
 *
 * @param droppableId - Unique ID for the droppable zone
 * @param attachments - The attachments object from ChatContext
 * @returns Object with droppable directive and isDraggingOver signal
 */
export function useEntityDropAttachment(
  droppableId: string,
  attachments: Attachments
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

    const attachment: Attachment | undefined = match(entityType)
      .with('document', () => ({
        entity_id: entityId,
        entity_type: 'document' as EntityType,
      }))
      .with('project', () => ({
        entity_id: entityId,
        entity_type: 'project' as EntityType,
      }))
      .with(P.union('channel', 'channel_message'), () => {
        const channelId =
          'channelId' in data ? (data.channelId as string) : entityId;
        return {
          entity_id: channelId,
          entity_type: 'channel' as EntityType,
        };
      })
      .with('email', () => ({
        entity_id: entityId,
        entity_type: 'email_thread' as EntityType,
      }))
      .with('chat', () => undefined)
      .with('call', () => undefined)
      .with('automation', () => undefined)
      .with('foreign', () => undefined)
      .exhaustive();

    if (attachment) {
      attachments.addAttachment(attachment);
    }
  });

  return { droppable, isDraggingOver };
}
