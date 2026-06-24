import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from '@lexical/list';
import { $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { $updateAllNodeIds } from '../../../../lexical-core/plugins/nodeIdPlugin';
import type { Session } from './session';

export type ListKind = 'bullet' | 'number' | 'check';

/**
 * Convert a set of blocks into a single list of the given kind. Each block
 * becomes a list item carrying that block's inline content. The list replaces
 * the first block; the rest are removed. Returns the new `ListNode`.
 */
export function $toggleList(blocks: LexicalNode[], type: ListKind): ListNode {
  const [first, ...rest] = blocks;
  if (!first || !$isElementNode(first)) {
    throw new Error('$toggleList needs at least one block');
  }
  // $toggleList WRAPS plain blocks into a new list. To change the type of a list
  // that already exists, use $setListType (which preserves nesting) — wrapping a
  // list item here would orphan it to the top level.
  if ($isListItemNode(first)) {
    throw new Error(
      '$toggleList wraps non-list blocks; to change an existing list type use $setListType'
    );
  }
  const list = $createListNode(type as ListType);
  const makeItem = (block: ElementNode) => {
    const item = $createListItemNode(type === 'check' ? false : undefined);
    item.append(...block.getChildren());
    return item;
  };
  list.append(makeItem(first));
  for (const node of rest) {
    if ($isElementNode(node)) {
      list.append(makeItem(node));
    }
  }
  first.replace(list);
  for (const node of rest) {
    node.remove();
  }
  return list;
}

/**
 * Change the type of the list enclosing `node` (a list, or any item in it) —
 * bullet ↔ number ↔ check — retyping the list node itself, preserving its
 * position, nesting, indentation, and the items' ids. Returns the retyped list.
 *
 * The retyped list gets a FRESH durable id (not the old one): a list-type change
 * replaces the `<ul>`/`<ol>` node, and the Loro sync can't reshape a container in
 * place — reusing the id makes the change vanish on sync, whereas a fresh id
 * reads as a clean delete + insert. Every id that referred to the old list (e.g.
 * the model's pre-change list id) is forwarded to the replacement, and the items
 * carry over via `replace(…, true)` with their own ids intact. Mirrors
 * `$setBlockType`.
 */
export function $setListType(
  node: LexicalNode,
  type: ListKind,
  session: Session
): ListNode {
  let list: LexicalNode | null = node;
  while (list && !$isListNode(list)) {
    list = list.getParent();
  }
  if (!$isListNode(list)) {
    throw new Error('$setListType: no enclosing list');
  }
  const oldKey = list.getKey();
  const retyped = $createListNode(type as ListType);
  list.replace(retyped, true);
  $updateAllNodeIds(session.ids, retyped);
  const { idToNodeKeyMap } = session.ids;
  const newKey = retyped.getKey();
  for (const [id, key] of idToNodeKeyMap) {
    if (key === oldKey) idToNodeKeyMap.set(id, newKey);
  }
  return retyped;
}

/** Check/uncheck a list item. */
export function $setChecked(item: LexicalNode, checked: boolean): void {
  if (!$isListItemNode(item)) {
    throw new Error('$setChecked target is not a list item');
  }
  item.setChecked(checked);
}

/** Nest a list item one level deeper. */
export function $indent(block: LexicalNode): void {
  if (!$isListItemNode(block)) {
    throw new Error('$indent target is not a list item');
  }
  block.setIndent(block.getIndent() + 1);
}

/** Un-nest a list item one level. */
export function $outdent(block: LexicalNode): void {
  if (!$isListItemNode(block)) {
    throw new Error('$outdent target is not a list item');
  }
  block.setIndent(Math.max(0, block.getIndent() - 1));
}
