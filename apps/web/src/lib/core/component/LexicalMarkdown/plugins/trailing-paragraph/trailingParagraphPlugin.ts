import { $isCodeNode } from '@lexical/code';
import { $isTableNode } from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $isDecoratorNode,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  RootNode,
} from 'lexical';

type BlockGap = {
  previousKey: NodeKey;
  nextKey: NodeKey;
};

function $needsTrailingParagraph(
  node: LexicalNode | null | undefined
): node is LexicalNode {
  const isBlockDecorator = $isDecoratorNode(node) && !node.isInline();
  return isBlockDecorator || $isCodeNode(node) || $isTableNode(node);
}

function getBlockGapAtPoint(
  editor: LexicalEditor,
  clientY: number
): BlockGap | null {
  return editor.read(() => {
    const children = $getRoot().getChildren();
    for (let index = 0; index < children.length - 1; index++) {
      const previous = children[index];
      const next = children[index + 1];
      if (
        !$needsTrailingParagraph(previous) ||
        !$needsTrailingParagraph(next)
      ) {
        continue;
      }

      const previousElement = editor.getElementByKey(previous.getKey());
      const nextElement = editor.getElementByKey(next.getKey());
      if (!previousElement || !nextElement) continue;

      const previousRect = previousElement.getBoundingClientRect();
      const nextRect = nextElement.getBoundingClientRect();
      if (clientY > previousRect.bottom && clientY < nextRect.top) {
        return {
          previousKey: previous.getKey(),
          nextKey: next.getKey(),
        };
      }
    }
    return null;
  });
}

/**
 * Keep an editable caret target after a block decorator, code block, or table
 * at the end of the document. Clicking the gap between two such blocks also
 * creates an editable paragraph there. Inline decorators do not need a
 * separate paragraph.
 */
export function trailingParagraphPlugin() {
  return (editor: LexicalEditor) => {
    const handleClick = (event: MouseEvent) => {
      const rootElement = editor.getRootElement();
      if (
        !editor.isEditable() ||
        event.button !== 0 ||
        event.defaultPrevented ||
        event.target !== rootElement
      ) {
        return;
      }

      const gap = getBlockGapAtPoint(editor, event.clientY);
      if (!gap) return;

      event.preventDefault();
      editor.update(
        () => {
          const previous = $getNodeByKey(gap.previousKey);
          const next = $getNodeByKey(gap.nextKey);
          if (
            !$needsTrailingParagraph(previous) ||
            !$needsTrailingParagraph(next) ||
            previous.getNextSibling() !== next
          ) {
            return;
          }
          previous.insertAfter($createParagraphNode()).selectStart();
        },
        { discrete: true, tag: HISTORY_PUSH_TAG }
      );
      editor.focus();
    };

    return mergeRegister(
      editor.registerNodeTransform(RootNode, (root) => {
        if ($needsTrailingParagraph(root.getLastChild())) {
          root.append($createParagraphNode());
        }
      }),
      editor.registerRootListener((root, previousRoot) => {
        previousRoot?.removeEventListener('click', handleClick);
        root?.addEventListener('click', handleClick);
      })
    );
  };
}
