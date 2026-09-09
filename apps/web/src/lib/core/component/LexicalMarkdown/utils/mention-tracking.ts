import { type BlockName, NonDocumentBlockTypes } from '@core/block';

const NON_DOCUMENT_BLOCK_NAMES = new Set<string>(NonDocumentBlockTypes);

/** Entity-mention tracking is a document-source API. Skip it in chats,
 *  channels, agent sessions, and other non-document blocks. */
export function canTrackMentionFromBlock(
  blockName: BlockName | undefined
): boolean {
  if (blockName == null) return false;
  return !NON_DOCUMENT_BLOCK_NAMES.has(blockName);
}
