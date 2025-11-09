/**
 * @file Handle focus change between title editor and main editor for the markdown block.
 */

import {
  $getCaretRect,
  isRectFlushWith,
} from '@core/component/LexicalMarkdown/utils';
import { mergeRegister } from '@lexical/utils';
import { $isSelectionInsideCode } from '@lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import type { Accessor } from 'solid-js';

export function keyNavigationPlugin(
  titleEditor: LexicalEditor,
  ignoreArrows: Accessor<boolean>
) {
  return (documentEditor: LexicalEditor) => {
    // Press arrow up in the main editor.
    return mergeRegister(
      documentEditor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event: KeyboardEvent) => {
          // if we are ignoring arrows (because the mentions menu is open) then do
          // nothing and capture the event.
          if (ignoreArrows()) return true;
          const lexicalSelection = $getSelection();
          if (!$isRangeSelection(lexicalSelection)) return false;
          if ($isSelectionInsideCode(lexicalSelection)) return false;
          const rect = documentEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'top', 5)) return false;

          event?.preventDefault();
          titleEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            firstChild?.selectStart();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      documentEditor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const lexicalSelection = $getSelection();
          if (
            !$isRangeSelection(lexicalSelection) ||
            !lexicalSelection.isCollapsed()
          )
            return false;

          const anchorNode = lexicalSelection.anchor.getNode();
          if (
            lexicalSelection.anchor.offset !== 0 ||
            anchorNode.getIndexWithinParent() !== 0
          )
            return false;

          const parent = anchorNode.getParent();
          if (parent !== $getRoot().getFirstChild() && parent !== $getRoot())
            return false;

          event?.preventDefault();
          titleEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            firstChild?.selectEnd();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      documentEditor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event: KeyboardEvent) => {
          if (ignoreArrows()) return true;
          const lexicalSelection = $getSelection();
          if (
            !$isRangeSelection(lexicalSelection) ||
            !lexicalSelection.isCollapsed()
          )
            return false;

          const anchorNode = lexicalSelection.anchor.getNode();
          if (
            lexicalSelection.anchor.offset !== 0 ||
            anchorNode.getIndexWithinParent() !== 0
          )
            return false;

          const parent = $isTextNode(anchorNode)
            ? anchorNode.getParent()
            : anchorNode;
          if (!parent) return false;
          if (parent !== $getRoot().getFirstChild()) return false;

          if (parent.getType() !== 'paragraph') return false;
          if (parent.getIndent() !== 0) return false; // handle indent as usual

          // Remove empty paragraph only if there are following nodes.
          if (
            parent.getTextContent() === '' &&
            $getRoot().getChildren().length > 1
          ) {
            const key = parent.getKey();
            queueMicrotask(() => {
              documentEditor.update(
                () => {
                  const node = $getNodeByKey(key);
                  if (!node) return;
                  node.remove();
                },
                { tag: 'historic', discrete: true }
              );
            });
          }

          event?.preventDefault();
          titleEditor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            firstChild?.selectEnd();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      documentEditor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          return ignoreArrows();
        },
        COMMAND_PRIORITY_NORMAL
      ),
      documentEditor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        () => {
          return ignoreArrows();
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  };
}
