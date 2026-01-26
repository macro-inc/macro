import type { BlockAlias, BlockName } from '@core/block';
import { trackMention } from '@core/signal/mention';
import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { INSERT_FOLD_NODE_COMMAND } from '../plugins/mentions';
import {
  type HandlerDependencies,
  entityMapper,
  getCombinedEntityBlockName,
  getItemName,
  handleBasicMention,
} from './mentionsUtils';
import { fetchDocumentAsMarkdown } from '@queries/storage/markdownText';

/** Document types that support FoldNode (text-based content) */
// TODO
const FOLD_SUPPORTED_BLOCK_NAMES: Set<BlockName | BlockAlias> = new Set([
  'task',
  'write',
  'md',
  'code',
]);

/**
 * Check if a block name supports FoldNode insertion.
 * FoldNode is used for text-based documents where content can be displayed inline.
 */
export function supportsFoldNode(blockName: BlockName | BlockAlias): boolean {
  return FOLD_SUPPORTED_BLOCK_NAMES.has(blockName);
}

/**
 * Insert a FoldNode with document content for supported document types.
 * Falls back to handleBasicMention for unsupported types or errors.
 * @param item The document item to mention
 * @param dependencies Handler dependencies
 */
export async function handleFoldMention(
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

  // Check if this document type supports FoldNode
  if (!supportsFoldNode(itemBlock)) {
    return handleBasicMention(item, dependencies);
  }

  let text;
  if (itemBlock === 'md' || itemBlock === 'task') {
    const result = await fetchDocumentAsMarkdown(item.id);
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
      console.error('Failed to fetch document content for FoldNode:', result);
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

  editor.dispatchCommand(INSERT_FOLD_NODE_COMMAND, {
    documentId: item.id,
    documentName: itemName,
    blockName: itemBlock,
    content: text,
    collapsed: true,
    mentionUuid: mentionId,
  });
}
