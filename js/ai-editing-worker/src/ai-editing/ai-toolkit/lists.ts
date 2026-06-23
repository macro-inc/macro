import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from '@lexical/list';
import { $createTextNode, $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { $getId, $setId } from '../../../../lexical-core/plugins/nodeIdPlugin';
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
 * Change the type of the list enclosing `node` (a list, or any item in it) in
 * place — bullet ↔ number ↔ check. List type is a property of the list, not the
 * item, so this retypes the list node itself, preserving its position, nesting,
 * indentation, and the items' ids. Returns the retyped list.
 */
export function $setListType(node: LexicalNode, type: ListKind, s?: Session): ListNode {
  let list: LexicalNode | null = node;
  while (list && !$isListNode(list)) {
    list = list.getParent();
  }
  if (!$isListNode(list)) {
    throw new Error('$setListType: no enclosing list');
  }
  const oldId = $getId(list);
  const retyped = $createListNode(type as ListType);
  list.replace(retyped, true);
  if (oldId && s) {
    $setId(retyped, oldId);
    s.ids.idToNodeKeyMap.set(oldId, retyped.getKey());
    s.ids.nodeKeyToIdMap.set(retyped.getKey(), oldId);
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

/**
 * Sort the items of the list enclosing `node` (a list node, or any node inside
 * one) alphabetically by their text. `order` defaults to ascending.
 */
export function $sortList(
  node: LexicalNode,
  opts?: { order?: 'asc' | 'desc' }
): void {
  let list: LexicalNode | null = node;
  while (list && !$isListNode(list)) {
    list = list.getParent();
  }
  if (!$isListNode(list)) {
    throw new Error('$sortList: no enclosing list');
  }
  const items = list.getChildren().filter($isListItemNode);
  const sorted = [...items].sort((a, b) =>
    a.getTextContent().localeCompare(b.getTextContent())
  );
  if (opts?.order === 'desc') {
    sorted.reverse();
  }
  // Re-append in sorted order (append moves an already-attached child).
  for (const item of sorted) {
    list.append(item);
  }
}
