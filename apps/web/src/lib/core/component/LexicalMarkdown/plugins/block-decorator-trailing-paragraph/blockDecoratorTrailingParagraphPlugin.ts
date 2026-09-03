import {
  $createParagraphNode,
  $isDecoratorNode,
  type LexicalEditor,
  RootNode,
} from 'lexical';

/**
 * Keep an editable caret target after a block decorator at the end of the
 * document. Inline decorators do not need a separate paragraph.
 */
export function blockDecoratorTrailingParagraphPlugin() {
  return (editor: LexicalEditor) =>
    editor.registerNodeTransform(RootNode, (root) => {
      const lastChild = root.getLastChild();
      if (!$isDecoratorNode(lastChild) || lastChild.isInline()) return;
      root.append($createParagraphNode());
    });
}
