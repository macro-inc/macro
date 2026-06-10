import { itemToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import type { DocumentMentionInfo } from '@lexical-core';

// Keep these in sync with `@block-channel/constants` `URL_PARAMS`. They are
// inlined here to avoid a circular dependency (`@block-channel` imports
// `@channel`).
const CHANNEL_MESSAGE_PARAM = 'channel_message_id';
const CHANNEL_THREAD_PARAM = 'channel_thread_id';

/**
 * Converts a dragged soup entity into the payload needed to insert a document
 * mention into a channel input. Mirrors the behavior of dropping an entity into
 * a markdown document. Returns `undefined` when the entity cannot be mentioned.
 */
export function entityToDocumentMentionInfo(
  entity: EntityData
): DocumentMentionInfo | undefined {
  const blockName = itemToBlockName(entity);
  if (!blockName || blockName === 'unknown') return undefined;

  // A dragged channel message mentions its parent channel, deep-linked to the
  // specific message (and thread, when present).
  if (entity.type === 'channel_message') {
    const blockParams: Record<string, string> = {
      [CHANNEL_MESSAGE_PARAM]: entity.messageId,
    };
    if (entity.threadId) {
      blockParams[CHANNEL_THREAD_PARAM] = entity.threadId;
    }
    return {
      documentId: entity.channelId,
      documentName: entity.name,
      blockName,
      blockParams,
      channelType: entity.channelType,
    };
  }

  return {
    documentId: entity.id,
    documentName: entity.name,
    blockName,
    channelType: entity.type === 'channel' ? entity.channelType : undefined,
  };
}
