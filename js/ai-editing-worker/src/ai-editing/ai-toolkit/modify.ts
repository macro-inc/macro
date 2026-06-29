import { $isListItemNode } from '@lexical/list';
import { $findMatchingParent, $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { match } from 'ts-pattern';
import { $isEquationNode } from '../../../../lexical-core/nodes/EquationNode';
import { $blockNode, $setBlockType, $setText, type BlockData } from './blocks';
import { $setListType, type ListKind } from './lists';
import { $byId } from './locate';
import type { LexicalSession } from './session';

/**
 * A single in-place modification, discriminated by `op`. Each variant carries
 * only the fields relevant to that operation, and applies to the node kind that
 * operation makes sense for (resolved up from the given id):
 *   - blockType/text → the enclosing block-level element
 *   - listType       → the enclosing list
 *   - checked/indent → the enclosing list item
 * `text`/`checked`/`indent`/`listType` preserve durable ids. `blockType` mints a
 * FRESH id (it replaces the node — see `$setBlockType`), as do the explicit
 * fresh-id operations (`$insert`, `$replaceBlock`).
 */
export type NodeChange =
  | { op: 'blockType'; block: BlockData }
  | { op: 'text'; text: string }
  | { op: 'equation'; tex: string }
  | { op: 'listType'; list: ListKind }
  | { op: 'checked'; checked: boolean }
  | { op: 'indent'; indent: number | 'in' | 'out' };

function $asBlock(node: LexicalNode, id: string): ElementNode {
  const b = $findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline());
  if (!$isElementNode(b)) {
    throw new Error(`$modifyNode: no block-level node for "${id}"`);
  }
  return b;
}

function $asListItem(node: LexicalNode, id: string) {
  const item = $findMatchingParent(node, $isListItemNode);
  if (!$isListItemNode(item)) {
    throw new Error(`$modifyNode: no list item for "${id}"`);
  }
  return item;
}

/**
 * Modify a node in place, addressed by id OR a node (e.g. one from `$byId`).
 * `change` is a discriminated union — see `NodeChange`. Returns the (possibly
 * retyped) primary node.
 */
export function $modifyNode(
  session: LexicalSession,
  target: string | LexicalNode,
  change: NodeChange
): LexicalNode {
  const node = typeof target === 'string' ? $byId(session, target) : target;
  const label = typeof target === 'string' ? target : node.getType();
  return match(change)
    .returnType<LexicalNode>()
    .with({ op: 'blockType' }, (c) =>
      $setBlockType(session, $asBlock(node, label), () => $blockNode(c.block))
    )
    .with({ op: 'text' }, (c) => {
      const block = $asBlock(node, label);
      $setText(block, c.text);
      return block;
    })
    .with({ op: 'equation' }, (c) => {
      if (!$isEquationNode(node)) {
        throw new Error(`$modifyNode: "${label}" is not an equation node`);
      }
      node.setEquation(c.tex);
      return node;
    })
    .with({ op: 'listType' }, (c) => $setListType(node, c.list, session))
    .with({ op: 'checked' }, (c) => {
      const item = $asListItem(node, label);
      item.setChecked(c.checked);
      return item;
    })
    .with({ op: 'indent' }, (c) => {
      const item = $asListItem(node, label);
      const cur = item.getIndent();
      item.setIndent(
        c.indent === 'in'
          ? cur + 1
          : c.indent === 'out'
            ? Math.max(0, cur - 1)
            : c.indent
      );
      return item;
    })
    .exhaustive();
}
