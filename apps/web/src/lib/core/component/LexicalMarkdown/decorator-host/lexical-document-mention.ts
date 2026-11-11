import {
  $convertMentionToCard,
  $isDocumentMentionNode,
  DocumentCardNode,
} from '@macro-inc/lexical-core';
import {
  $createTextNode,
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import { UPDATE_DOCUMENT_NAME_COMMAND } from '../plugins';
import type { DocumentMentionHost } from './document-mention-host';

/** Keep Source editor calls and transaction boundaries unchanged. */
export function createLexicalDocumentMentionHost(
  wrapper: LexicalWrapper | undefined
): DocumentMentionHost {
  const editor = wrapper?.editor;
  return {
    isSelected: (key) =>
      wrapper?.selection?.type === 'node' &&
      wrapper.selection.nodeKeys.has(key),
    isEditable: () => editor?.isEditable() ?? false,
    isInteractable: () => wrapper?.isInteractable() ?? false,
    canEmbed: () =>
      !!wrapper?.isInteractable() && !!editor?.hasNode(DocumentCardNode),
    get skipPreviewFetch() {
      return wrapper?.skipPreviewFetch ?? false;
    },
    registerEditableListener: (listener) =>
      editor?.registerEditableListener(listener),
    registerNormalEnter: (listener) =>
      editor?.registerCommand(
        KEY_ENTER_COMMAND,
        listener,
        COMMAND_PRIORITY_NORMAL
      ),
    updateDocumentNames: (names) => {
      editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, names);
    },
    remove(key) {
      editor?.update(() => {
        const node = $getNodeByKey(key);
        if (!$isDocumentMentionNode(node)) return false;
        node.remove();
        return true;
      });
    },
    convertToText(key, text) {
      editor?.update(() => {
        const node = $getNodeByKey(key);
        if (!$isDocumentMentionNode(node)) return;
        node.replace($createTextNode(text));
      });
    },
    convertToCard(key) {
      editor?.update(() => {
        const node = $getNodeByKey(key);
        if (!$isDocumentMentionNode(node)) return false;
        $convertMentionToCard(node);
        return true;
      });
    },
    setCollapsed(key, collapsed) {
      editor?.update(() => {
        const node = $getNodeByKey(key);
        if ($isDocumentMentionNode(node)) node.setCollapsed(collapsed);
      });
    },
  };
}
