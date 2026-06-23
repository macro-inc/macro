import { $isCodeNode } from '@lexical/code';
import { $isCustomCodeNode } from '@lexical-core';
import type { LexicalEditor, NodeKey } from 'lexical';
import { removeNodeAndRestoreSelection } from '../shared/removeNodeAndRestoreSelection';

/**
 * Removes a code block from the editor and leaves the selection anchored in a
 * live node. If the code block was the only child, recreate the empty paragraph
 * shape that the rest of the markdown editor expects.
 */
export function deleteCodeNode(editor: LexicalEditor, nodeKey: NodeKey) {
  removeNodeAndRestoreSelection(
    editor,
    nodeKey,
    (node) => $isCodeNode(node) || $isCustomCodeNode(node)
  );
}
