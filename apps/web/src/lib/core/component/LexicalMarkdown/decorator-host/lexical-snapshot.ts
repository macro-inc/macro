import { $isSnapshotNode } from '@macro-inc/lexical-core';
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from 'lexical';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import { removeNodeAndRestoreSelection } from '../plugins/shared/removeNodeAndRestoreSelection';
import type { SnapshotHost } from './snapshot-host';

/** Capture the same Source editor at component construction. */
export function createLexicalSnapshotHost(
  wrapper: LexicalWrapper | undefined
): SnapshotHost {
  const editor = wrapper?.editor;
  return {
    isSelected(key) {
      const selection = wrapper?.selection;
      return selection?.type === 'node' && selection.nodeKeys.has(key);
    },
    isEditable: () => editor?.isEditable() ?? false,
    registerNormalEnter(listener) {
      return editor?.registerCommand(
        KEY_ENTER_COMMAND,
        listener,
        COMMAND_PRIORITY_NORMAL
      );
    },
    remove(key) {
      if (editor) removeNodeAndRestoreSelection(editor, key, $isSnapshotNode);
    },
  };
}
