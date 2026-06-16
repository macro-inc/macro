/**
 * @file A plugin to enforce a single line only.
 */
import { mergeRegister } from '@lexical/utils';
import {
  $isRootNode,
  type LexicalEditor,
  LineBreakNode,
  ParagraphNode,
  RootNode,
} from 'lexical';

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
      }),

      // Programmatic inserts (snippets, paste) can nest block paragraphs inside
      // the single root paragraph, which the root-child check above doesn't
      // catch. Unwrap them so a nested block's inline content collapses onto the
      // one line instead of rendering as extra rows.
      editor.registerNodeTransform(ParagraphNode, (node) => {
        const parent = node.getParent();
        if (!parent || $isRootNode(parent)) return;
        for (const child of node.getChildren()) {
          node.insertBefore(child);
        }
        node.remove();
      })
    );
  };
}
