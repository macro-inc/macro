import {
  $convertCardToMention,
  $getId,
  $isDocumentCardNode,
  HISTORY_MERGE_TAG,
  setDocumentCardPreviewComponent,
  unsetDocumentCardPreviewCache,
} from '@macro-inc/lexical-core';
import {
  $addUpdateTag,
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { getOwner } from 'solid-js';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import { UPDATE_DOCUMENT_NAME_COMMAND } from '../plugins';
import { removeNodeAndRestoreSelection } from '../plugins/shared/removeNodeAndRestoreSelection';
import { dispatchInternalLayoutShift } from '../plugins/shared/utils';
import type { DocumentCardHost } from './document-card-host';

export function createLexicalDocumentCardHost(
  wrapper: LexicalWrapper | undefined
): DocumentCardHost {
  const editor = () => wrapper?.editor;
  return {
    available: () => !!editor(),
    isSelected: (key) =>
      wrapper?.selection?.type === 'node' &&
      wrapper.selection.nodeKeys.has(key),
    isEditable: () => editor()?.isEditable() ?? false,
    isInteractable: () => wrapper?.isInteractable() ?? false,
    get skipPreviewFetch() {
      return wrapper?.skipPreviewFetch ?? false;
    },
    previewOwner: wrapper?.owner ?? getOwner(),
    registerEditableListener: (listener) =>
      editor()?.registerEditableListener(listener),
    layoutChanged() {
      const current = editor();
      if (current) dispatchInternalLayoutShift(current);
    },
    select(key) {
      const current = editor();
      if (!current) return;
      current.update(() => {
        const selection = $createNodeSelection();
        selection.add(key);
        $setSelection(selection);
      });
    },
    remove(key) {
      const current = editor();
      if (current)
        removeNodeAndRestoreSelection(current, key, $isDocumentCardNode);
    },
    convertToMention(key, selectEnd = false) {
      editor()?.update(() => {
        const node = $getNodeByKey(key);
        if (!$isDocumentCardNode(node)) return false;
        const mention = $convertCardToMention(node);
        if (selectEnd) mention.selectEnd();
        return true;
      });
    },
    setPreviewHeight(key, height) {
      editor()?.update(() => {
        $addUpdateTag(HISTORY_MERGE_TAG);
        const node = $getNodeByKey(key);
        if (!$isDocumentCardNode(node)) return;
        const [width] = node.getPreviewBox();
        node.setPreviewBox([width, height]);
        dispatchInternalLayoutShift(editor()!);
      });
    },
    setCanvasLocation(key, location) {
      const current = editor();
      if (!current) return;
      const focused = document.activeElement;
      const restoreFocus =
        focused instanceof HTMLElement &&
        current.getElementByKey(key)?.contains(focused);
      current.update(
        () => {
          $addUpdateTag(HISTORY_MERGE_TAG);
          const node = $getNodeByKey(key);
          if (!$isDocumentCardNode(node)) return;
          node.setPreviewData({ view: location });
        },
        {
          onUpdate: () => {
            if (
              restoreFocus &&
              focused instanceof HTMLElement &&
              focused.isConnected
            )
              focused.focus({ preventScroll: true });
          },
        }
      );
    },
    setPreviewBox(key, box) {
      editor()?.update(() => {
        const node = $getNodeByKey(key);
        if (!$isDocumentCardNode(node)) return false;
        node.setPreviewBox(box);
        return true;
      });
    },
    setBlockParams(key, params) {
      editor()?.update(
        () => {
          const node = $getNodeByKey(key);
          if ($isDocumentCardNode(node)) node.setBlockParams(params);
        },
        { tag: SKIP_DOM_SELECTION_TAG }
      );
    },
    observeBlockParams(key, listener) {
      return editor()?.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const node = $getNodeByKey(key);
          if ($isDocumentCardNode(node)) listener(node.getBlockParams());
        });
      });
    },
    updateDocumentNames(names) {
      editor()?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, names);
    },
    nodeId(key) {
      return editor()?.read(() => {
        const node = $getNodeByKey(key);
        if (node) return $getId(node);
      });
    },
    cachePreview: setDocumentCardPreviewComponent,
    clearPreview: unsetDocumentCardPreviewCache,
  };
}
