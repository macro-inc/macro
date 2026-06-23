import { $isListItemNode } from '@lexical/list';
import { $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { match } from 'ts-pattern';
import { $isEquationNode } from '../../../../lexical-core/nodes/EquationNode';
import { $blockNode, $setBlockType, $setText, type BlockData } from './blocks';
import { $setListType, type ListKind } from './lists';
import { $byId } from './locate';
import type { Session } from './session';

/**
 * A single in-place modification, discriminated by `op`. Each variant carries
 * only the fields relevant to that operation, and applies to the node kind that
 * operation makes sense for (resolved up from the given id):
 *   - blockType/text → the enclosing block-level element
 *   - listType       → the enclosing list
 *   - checked/indent → the enclosing list item
 * Durable ids are preserved. This is distinct from the fresh-id operations
 * (`$insert`, `$replaceBlock`) which create new nodes.
 */
export type NodeChange =
  | { op: 'blockType'; block: BlockData }
  | { op: 'text'; text: string }
  | { op: 'equation'; tex: string }
  | { op: 'listType'; list: ListKind }
  | { op: 'checked'; checked: boolean }
  | { op: 'indent'; indent: number | 'in' | 'out' };

function climbWhile(
  node: LexicalNode,
  pred: (n: LexicalNode) => boolean
): LexicalNode | null {
  let n: LexicalNode | null = node;
  while (n && !pred(n)) {
    n = n.getParent();
  }
  return n;
}

function $asBlock(node: LexicalNode, id: string): ElementNode {
  const b = climbWhile(node, (n) => $isElementNode(n) && !n.isInline());
  if (!$isElementNode(b)) {
    throw new Error(`$modifyNode: no block-level node for "${id}"`);
  }
  return b;
}

function $asListItem(node: LexicalNode, id: string) {
  const item = climbWhile(node, $isListItemNode);
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
  s: Session,
  target: string | LexicalNode,
  change: NodeChange
): LexicalNode {
  const node = typeof target === 'string' ? $byId(s, target) : target;
  const label = typeof target === 'string' ? target : node.getType();
  return match(change)
    .returnType<LexicalNode>()
    .with({ op: 'blockType' }, (c) =>
      $setBlockType(s, $asBlock(node, label), () => $blockNode(c.block))
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
    .with({ op: 'listType' }, (c) => $setListType(node, c.list, s))
    .with({ op: 'checked' }, (c) => {
      const item = $asListItem(node, label);
      item.setChecked(c.checked);
      return item;
    })
    .with({ op: 'indent' }, (c) => {
      const item = $asListItem(node, label);
      const cur = item.getIndent();
      item.setIndent(
        c.indent === 'in' ? cur + 1 : c.indent === 'out' ? Math.max(0, cur - 1) : c.indent
      );
      return item;
    })
    .exhaustive();
}
