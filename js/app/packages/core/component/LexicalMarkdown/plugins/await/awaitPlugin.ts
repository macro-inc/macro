import { $createAwaitNode, $isAwaitNode, type AwaitNode } from '@lexical-core';
import { mergeRegister, $wrapNodeInElement } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $collapseSelection, $traverseNodes } from '../../utils';

export type InsertAwaitPayload = {
  awaitId: string;
  text?: string;
  inline?: boolean;
};

/**
 * Pre-generated awaitId + optional placeholder text. Caller is responsible
 * for tracking the awaitId so a later REPLACE_AWAIT_NODE_COMMAND can find it.
 */
export const INSERT_AWAIT_NODE_COMMAND = createCommand<InsertAwaitPayload>(
  'INSERT_AWAIT_NODE_COMMAND'
);

export type ReplaceAwaitPayload = {
  awaitId: string;
  /**
   * Run inside `editor.update`. Return node(s) to replace the await with, or
   * null/undefined / empty to delete it.
   */
  $createReplacement?: () => LexicalNode | LexicalNode[] | null | undefined;
};

export const REPLACE_AWAIT_NODE_COMMAND = createCommand<ReplaceAwaitPayload>(
  'REPLACE_AWAIT_NODE_COMMAND'
);

function $findAwaitNodeByAwaitId(awaitId: string): AwaitNode | null {
  let found: AwaitNode | null = null;
  $traverseNodes($getRoot(), (node) => {
    if (found) return;
    if ($isAwaitNode(node) && node.getAwaitId() === awaitId) {
      found = node;
    }
  });
  return found;
}

export function awaitPlugin() {
  console.log('using await plugin');
  return (editor: LexicalEditor) => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_AWAIT_NODE_COMMAND,
        (payload) => {
          console.log('INSERT_AWAIT_NODE_COMMAND', payload);

          editor.update(() => {
            const selection = $getSelection();
            const awaitNode = $createAwaitNode({
              awaitId: payload.awaitId,
              text: payload.text,
              inline: payload.inline ?? true,
            });

            if ($isRangeSelection(selection) && !selection.isCollapsed()) {
              $collapseSelection(selection);
              $insertNodes([$createTextNode(' '), awaitNode]);
            } else {
              $insertNodes([awaitNode]);
            }

            if ($isRootOrShadowRoot(awaitNode.getParentOrThrow())) {
              $wrapNodeInElement(awaitNode, $createParagraphNode);
            }
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),

      editor.registerCommand(
        REPLACE_AWAIT_NODE_COMMAND,
        (payload) => {
          console.log('REPLACE_AWAIT_NODE_COMMAND', payload);
          editor.update(() => {
            const target = $findAwaitNodeByAwaitId(payload.awaitId);
            if (!target) return;
            const replacement = payload.$createReplacement?.();
            const nodes = Array.isArray(replacement)
              ? replacement
              : replacement
                ? [replacement]
                : [];

            if (nodes.length === 0) {
              const next = target.getNextSibling();
              const prev = target.getPreviousSibling();
              target.remove();
              if (next) next.selectStart();
              else if (prev) prev.selectEnd();
              else $getRoot().selectEnd();
              return;
            }

            const first = nodes[0]!;
            target.replace(first);
            let cursor = first;
            for (let i = 1; i < nodes.length; i++) {
              const next = nodes[i]!;
              cursor.insertAfter(next);
              cursor = next;
            }
            cursor.selectEnd();
          });
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  };
}
