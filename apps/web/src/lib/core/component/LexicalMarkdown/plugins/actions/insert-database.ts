import { toast } from '@core/component/Toast/Toast';
import { trackMention, untrackMention } from '@core/signal/mention';
import {
  $convertMentionToCard,
  $createAwaitNode,
  $createDocumentMentionNode,
  $isAwaitNode,
} from '@macro-inc/lexical-core';
import { createDatabase } from '@queries/storage/databases';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { nanoid } from 'nanoid';
import type { ActionContext } from './types';

/** Keep the insertion anchored while creation runs, even if the caret moves. */
export async function insertNewDatabase(
  editor: LexicalEditor,
  context?: ActionContext
) {
  if (!editor.isEditable()) return;
  let placeholderKey: NodeKey | undefined;
  editor.update(() => {
    const placeholder = $createAwaitNode({
      awaitId: nanoid(),
      text: 'Creating database…',
    });
    $insertNodes([placeholder]);
    placeholderKey = placeholder.getKey();
  });

  const name = 'Untitled database';
  const created = await createDatabase({ name, source: 'slash-menu' });
  if (created.isErr()) {
    editor.update(() => {
      if (placeholderKey) $getNodeByKey(placeholderKey)?.remove();
    });
    toast.failure('Your database could not be created. Try again.');
    return;
  }

  // A successful create remains a database even when its placeholder was removed.
  const present = editor.read(() =>
    placeholderKey ? $isAwaitNode($getNodeByKey(placeholderKey)) : false
  );
  if (!present || !editor.isEditable()) return;
  const mentionUuid =
    context?.sourceDocumentId &&
    !context.disableMentionTracking &&
    context.sourceBlockName !== 'channel' &&
    context.sourceBlockName !== 'chat'
      ? await trackMention(context.sourceDocumentId, 'database', created.value)
      : undefined;

  const stillPresent = editor.read(() =>
    placeholderKey ? $isAwaitNode($getNodeByKey(placeholderKey)) : false
  );
  if (!stillPresent || !editor.isEditable()) {
    if (mentionUuid && context?.sourceDocumentId)
      await untrackMention(context.sourceDocumentId, mentionUuid);
    return;
  }

  editor.update(() => {
    const placeholder = placeholderKey ? $getNodeByKey(placeholderKey) : null;
    if (!$isAwaitNode(placeholder) || !editor.isEditable()) return;
    const selection = $getSelection();
    const focused =
      $isRangeSelection(selection) &&
      selection.getNodes().some((node) => node.getKey() === placeholderKey);
    const mention = $createDocumentMentionNode({
      documentId: created.value,
      documentName: name,
      blockName: 'database',
      mentionUuid,
    });
    placeholder.replace(mention);
    const card = $convertMentionToCard(mention);
    if (!card.getNextSibling()) {
      const paragraph = $createParagraphNode();
      card.insertAfter(paragraph);
      if (focused) paragraph.selectStart();
    }
  });
}
