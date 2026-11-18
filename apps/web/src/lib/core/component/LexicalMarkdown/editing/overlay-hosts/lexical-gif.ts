import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { type Accessor, onCleanup } from 'solid-js';
import type { PluginManager } from '../../plugins';
import { $insertGifNode, gifPickerPlugin } from '../../plugins/gif';
import { registerRootEventListener } from '../../plugins/shared/utils';
import type { GifMenuHost } from './gif';

interface LexicalGifInsertion {
  editor: LexicalEditor;
  root: HTMLElement | null;
  selection: BaseSelection | undefined;
}

/** Retain Source selection capture, dirty cancellation and discrete insertion. */
export function createLexicalGifMenuHost(
  editor: Accessor<LexicalEditor | undefined>,
  plugins: Accessor<PluginManager | undefined>
): GifMenuHost<BaseSelection | null, LexicalGifInsertion> {
  return {
    root: () => editor()?.getRootElement() ?? null,
    focus: () => editor()?.focus(),
    isEditable: () => editor()?.isEditable() ?? false,
    captureTarget() {
      const target = $getSelection()?.clone() ?? null;
      // Keep the command's commit from reclaiming focus from search.
      $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      return target;
    },
    prepareInsertion(target, canEdit) {
      const currentEditor = editor();
      if (!canEdit() || !currentEditor?.isEditable()) return;
      const selection = target?.clone();
      const root = currentEditor.getRootElement();
      return { editor: currentEditor, root, selection };
    },
    subscribeChanges(insertion, onDirty) {
      return insertion.editor.registerUpdateListener(
        ({ dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size || dirtyLeaves.size) onDirty();
        }
      );
    },
    isCurrent(insertion) {
      return (
        insertion.editor.isEditable() &&
        insertion.editor === editor() &&
        insertion.root === insertion.editor.getRootElement()
      );
    },
    commit(insertion, gif, staticFileId, onInserted) {
      let inserted = false;
      insertion.editor.update(
        () => {
          const selection = insertion.selection;
          // A cleared draft must not receive the old request's image.
          if (
            selection &&
            $isRangeSelection(selection) &&
            (!$getNodeByKey(selection.anchor.key)?.isAttached() ||
              !$getNodeByKey(selection.focus.key)?.isAttached())
          )
            return;
          if (selection) $setSelection(selection);
          else if (!$getSelection()) $getRoot().selectEnd();
          $insertGifNode(gif, staticFileId);
          onInserted();
          inserted = true;
        },
        { discrete: true }
      );
      return inserted;
    },
    registerPicker(canEdit, onOpen) {
      const currentPlugins = plugins();
      if (!currentPlugins) return;
      currentPlugins.useReactive(canEdit, () => {
        if (!canEdit()) return;
        return gifPickerPlugin({ onOpenPicker: onOpen });
      });
    },
    registerPanel(panel, cancelUpload) {
      const currentEditor = editor();
      if (!currentEditor) return;
      onCleanup(cancelUpload);
      onCleanup(
        registerRootEventListener(currentEditor, 'focusout', (event) => {
          if (
            event.relatedTarget instanceof Node &&
            panel.contains(event.relatedTarget)
          ) {
            event.stopPropagation();
          }
        })
      );
    },
  };
}
