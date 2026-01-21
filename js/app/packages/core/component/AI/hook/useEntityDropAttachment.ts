import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant';
import type { Attachment, Attachments } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityDragEvent } from '@macro-entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';

/**
 * Hook to handle entity drag-and-drop for chat attachments.
 * Creates a droppable zone and handles converting dropped entities to attachments.
 *
 * @param droppableId - Unique ID for the droppable zone
 * @param attachments - The attachments object from useChatInput
 * @returns The droppable directive to be used with `use:droppable`
 */
export function useEntityDropAttachment(
  droppableId: string,
  attachments: Attachments
): any {
  const droppable = createDroppable(droppableId);

  const [, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

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
    let attachment: Attachment | undefined;
    if (entityType === 'document') {
      const validFileType = asFileType(fileType);
      if (!validFileType) return;
      attachment = {
        id: `${entityId}-document-attachment`,
        attachmentId: entityId,
        attachmentType: 'document',
        metadata: {
          type: 'document',
          document_type: validFileType,
          document_name: entityName,
        },
      };
    } else if (entityType === 'project') {
      attachment = {
        id: `${entityId}-project-attachment`,
        attachmentId: entityId,
        attachmentType: 'project',
        metadata: {
          type: 'project',
          project_name: entityName,
        },
      };
    } else if (entityType === 'channel') {
      const channelType =
        'channelType' in data ? data.channelType : 'organization';
      attachment = {
        id: `${entityId}-channel-attachment`,
        attachmentId: entityId,
        attachmentType: 'channel',
        metadata: {
          type: 'channel',
          channel_type: channelType,
          channel_name: entityName,
        },
      };
    } else if (entityType === 'email') {
      attachment = {
        id: `${entityId}-email-attachment`,
        attachmentId: entityId,
        attachmentType: 'email',
        metadata: {
          type: 'email',
          email_subject: entityName,
        },
      };
    }

    if (attachment) {
      attachments.addAttachment(attachment);
    }
  });

  return droppable;
}
