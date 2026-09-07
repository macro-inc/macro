import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import { messageReference } from '@macro-inc/lexical-core/utils/message-references';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { PostMessageRequest } from '@service-storage/generated/schemas/postMessageRequest';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import type { InputAttachmentData, InputSnapshot } from './types';

export function attachmentEntityType(
  kind: InputAttachmentData['kind']
): string {
  switch (kind) {
    case 'image':
      return STATIC_IMAGE;
    case 'video':
      return STATIC_VIDEO;
    case 'document':
      return 'document';
  }
}

/** Serialize authored references; the server resolves group recipients using current membership. */
export function authoredMentions(mentions: ItemMention[]): SimpleMention[] {
  const seen = new Set<string>();
  const result: SimpleMention[] = [];
  for (const mention of mentions) {
    const reference = messageReference(
      mention.itemType,
      mention.itemType === 'group'
        ? (mention.groupAlias ?? mention.itemId)
        : mention.itemId
    );
    if (!reference) throw new Error('Unsupported message reference');
    const key = `${reference.entityType}:${reference.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      entity_type: reference.entityType,
      entity_id: reference.entityId,
    });
  }
  return result;
}

type BuildPostMessageRequestOptions = {
  snapshot: InputSnapshot;
  threadId?: string;
};

export type OptimisticPostMessageAttachment = {
  attachment: NewAttachment;
  previewSrc?: string;
};

export type PostMessageSendPayload = {
  message: PostMessageRequest;
  optimisticAttachments: OptimisticPostMessageAttachment[];
};

export function buildPostMessageSendPayload(
  options: BuildPostMessageRequestOptions
): PostMessageSendPayload {
  const { snapshot, threadId } = options;
  const optimisticAttachments = snapshot.attachments.map((attachment) => {
    const postAttachment = {
      entity_id: attachment.id,
      entity_type: attachmentEntityType(attachment.kind),
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    };

    return {
      attachment: postAttachment,
      previewSrc: attachment.previewSrc,
    };
  });

  return {
    message: {
      content: snapshot.value,
      thread_id: threadId,
      mentions: authoredMentions(snapshot.mentions),
      attachments: optimisticAttachments.map((item) => item.attachment),
    },
    optimisticAttachments,
  };
}

export function buildPostMessageRequest(
  options: BuildPostMessageRequestOptions
): PostMessageRequest {
  return buildPostMessageSendPayload(options).message;
}
