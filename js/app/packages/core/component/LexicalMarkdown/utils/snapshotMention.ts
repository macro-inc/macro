import type { BlockAlias, BlockName } from '@core/block';
import { trackMention } from '@core/signal/mention';
import { isErr } from '@core/util/maybeResult';
import { fetchDocumentAsMarkdown } from '@queries/storage/markdownText';
import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { INSERT_SNAPSHOT_NODE_COMMAND } from '../plugins/mentions';
import {
  entityMapper,
  getCombinedEntityBlockName,
  getItemName,
  type HandlerDependencies,
  handleBasicMention,
} from './mentionsUtils';

/** Document types that support SnapshotNode (text-based content) */
// TODO
const SNAPSHOT_SUPPORTED_BLOCK_NAMES: Set<BlockName | BlockAlias> = new Set([
  'task',
  'write',
  'md',
  'code',
]);

/**
 * Check if a block name supports SnapshotNode insertion.
 * SnapshotNode is used for text-based documents where content can be displayed inline.
 */
export function supportsSnapshotNode(
  blockName: BlockName | BlockAlias
): boolean {
  return SNAPSHOT_SUPPORTED_BLOCK_NAMES.has(blockName);
}

/**
 * Insert a SnapshotNode with document content for supported document types.
 * Falls back to handleBasicMention for unsupported types or errors.
 * @param item The document item to mention
 * @param dependencies Handler dependencies
 */
export async function handleSnapshotMention(
  item: Item,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;

  const itemEntity = entityMapper('item')(item);
  const itemBlock = getCombinedEntityBlockName(itemEntity);
  const itemName = getItemName(itemEntity);

  // Check if this document type supports SnapshotNode
  if (!supportsSnapshotNode(itemBlock)) {
    return handleBasicMention(item, dependencies);
  }

  let text: string;
  if (itemBlock === 'md' || itemBlock === 'task') {
    const result = await fetchDocumentAsMarkdown(item.id, 'internal');
    if (!result) {
      console.error('failed to fetch md');
      return;
    } else {
      text = result;
    }
  } else {
    // Fetch document content
    const result = await storageServiceClient.getTextDocument({
      documentId: item.id,
    });

    if (isErr(result)) {
      // Fall back to regular mention on error
      console.error(
        'Failed to fetch document content for SnapshotNode:',
        result
      );
      return;
    }
    text = result[1].text;
  }

  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', item.id);
  }

  onDocumentMention?.(item);

  editor.dispatchCommand(INSERT_SNAPSHOT_NODE_COMMAND, {
    documentId: item.id,
    documentName: itemName,
    blockName: itemBlock,
    content: text,
    snapshotDate: new Date().toISOString(),
    mentionUuid: mentionId,
  });
}
