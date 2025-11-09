/**
 * @file A plugin to enforce a single line only.
 */
import { mergeRegister } from '@lexical/utils';
import { type LexicalEditor, LineBreakNode, RootNode } from 'lexical';

export function singleLinePlugin() {
  return (editor: LexicalEditor) => {
    // enforce no more than one node in the title editor
    return mergeRegister(
      editor.registerNodeTransform(RootNode, (root: RootNode) => {
        if (root.getChildrenSize() <= 1) return;
        root.getLastChild()?.remove();
      }),

      editor.registerNodeTransform(LineBreakNode, (node) => {
        node.remove();
      })
    );
  };
}
