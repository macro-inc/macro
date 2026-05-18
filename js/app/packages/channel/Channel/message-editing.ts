import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import type { NewAttachment } from '@service-comms/generated/models/newAttachment';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import { attachmentEntityType } from '../Input/message-payload';
import type { InputAttachmentData, InputSnapshot } from '../Input/types';
import type { MessageData } from '../Message';

function toInputAttachmentKind(
  entityType: string
): InputAttachmentData['kind'] | undefined {
  if (entityType === STATIC_IMAGE) return 'image';
  if (entityType === STATIC_VIDEO) return 'video';
  if (!isStaticAttachmentType(entityType)) return 'document';
}

export function messageAttachmentToInputAttachment(
  attachment: ApiMessageAttachment
): InputAttachmentData | undefined {
  const kind = toInputAttachmentKind(attachment.entity_type);
  if (!kind) return;

  return {
    id: attachment.entity_id,
    name: attachment.entity_id,
    kind,
    iconType:
      kind === 'document'
        ? fileTypeToBlockName(attachment.entity_type, true)
        : undefined,
  };
}

export function buildMessageEditSnapshot(message: MessageData): InputSnapshot {
  return {
    value: message.content,
    mentions: [],
    attachments: message.attachments
      .map(messageAttachmentToInputAttachment)
      .filter((attachment): attachment is InputAttachmentData => !!attachment),
  };
}

export function getAttachmentIdsToDelete(args: {
  currentAttachments: ApiMessageAttachment[];
  nextSnapshot: InputSnapshot;
}) {
  const nextAttachmentIds = new Set(
    args.nextSnapshot.attachments.map((attachment) => attachment.id)
  );

  return args.currentAttachments
    .filter((attachment) => !nextAttachmentIds.has(attachment.entity_id))
    .map((attachment) => attachment.id);
}

export function getAttachmentsToAdd(args: {
  currentAttachments: ApiMessageAttachment[];
  nextSnapshot: InputSnapshot;
}): NewAttachment[] {
  const currentIds = new Set(
    args.currentAttachments.map((attachment) => attachment.entity_id)
  );

  return args.nextSnapshot.attachments
    .filter((attachment) => !currentIds.has(attachment.id))
    .map((attachment) => ({
      entity_id: attachment.id,
      entity_type: attachmentEntityType(attachment.kind),
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    }));
}
