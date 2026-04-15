import { match, P } from 'ts-pattern';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityDragData, EntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import type { AttachmentType } from '@service-cognition/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';

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
    const entityName = data.name;
    const entityType = data.type;
    const fileType = 'fileType' in data ? data.fileType : undefined;

    // Determine block name and check if it's a supported attachment type
    const blockName = fileTypeToBlockName(fileType ?? entityType, true);
    if (!SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName)) {
      toast.failure('This file type cannot be attached to chat');
      return;
    }

    // Build the attachment based on entity type
    const attachment = match(entityType)
      .with('document', () => {
        const validFileType = asFileType(fileType);
        if (!validFileType) return;
        return {
          id: `${entityId}-document-attachment`,
          attachmentId: entityId,
          attachmentType: 'document' satisfies AttachmentType,
          metadata: {
            type: 'document',
            document_type: validFileType,
            document_name: entityName,
          },
        } satisfies Attachment;
      })
      .with('project', () => {
        return {
          id: `${entityId}-project-attachment`,
          attachmentId: entityId,
          attachmentType: 'project' satisfies AttachmentType,
          metadata: {
            type: 'project',
            project_name: entityName,
          },
        } satisfies Attachment;
      })
      .with(P.union('channel', 'channel_message'), () => {
        const channelType =
          'channelType' in data ? data.channelType : 'organization';
        const channelId =
          'channelId' in data ? (data.channelId as string) : entityId;

        // TODO: channel_message attachments only reference the full channel, not the message
        return {
          id: `${channelId}-channel-attachment`,
          attachmentId: channelId,
          attachmentType: 'channel' satisfies AttachmentType,
          metadata: {
            type: 'channel',
            channel_type: channelType,
            channel_name: entityName,
          },
        } satisfies Attachment;
      })
      .with('email', () => {
        return {
          id: `${entityId}-email-attachment`,
          attachmentId: entityId,
          attachmentType: 'email' satisfies AttachmentType,
          metadata: {
            type: 'email',
            email_subject: entityName,
          },
        } satisfies Attachment;
      })
      .with('chat', () => undefined)
      .with('call', () => undefined)
      .exhaustive() satisfies Attachment | undefined;

    if (attachment) {
      attachments.addAttachment(attachment);
    }
  });

  return { droppable, isDraggingOver };
}
