import { $createCodeNode } from '@lexical/code';
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { match } from 'ts-pattern';
import { $isCustomCodeNode } from '../../../../lexical-core/nodes/CustomCodeNode';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { $retypeContainer, type LexicalSession } from './session';

export type BlockData =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number }
  | { type: 'quote' }
  | { type: 'code'; language?: string };

/** Build an (empty) block node to pass to `$setBlockType` / inserts. */
export function $blockNode(data: BlockData): ElementNode {
  return match(data)
    .returnType<ElementNode>()
    .with({ type: 'heading' }, (d) =>
      $createHeadingNode(`h${d.level}` as HeadingTagType)
    )
    .with({ type: 'quote' }, () => $createQuoteNode())
    .with({ type: 'code' }, (d) => $createCodeNode(d.language))
    .with({ type: 'paragraph' }, () => $createParagraphNode())
    .exhaustive();
}

/** Change a block's type, transplanting its content onto a fresh-id node. */
export function $setBlockType(
  session: LexicalSession,
  block: ElementNode,
  make: () => ElementNode
): ElementNode {
  return $retypeContainer(session, block, make());
}

/** Rewrite a block's inline content to plain text, keeping its type and id. Always strips any inline formatting (bold, italic, underline, etc.) on the kept node. */
export function $setText(block: ElementNode, text: string): void {
  // A code block's children are code-highlight nodes (re-tokenized from the
  // block's text by Prism), so we use `setCode`, which splices the whole
  // content in one shot, keeping the language.
  if ($isCustomCodeNode(block)) {
    block.setCode(block.getLanguage(), text);
    return;
  }
  const children = block.getChildren();
  const existing = children.find($isTextNode);
  if (existing) {
    existing.setTextContent(text);
    existing.setFormat(0);
    for (const child of children) {
      if (child !== existing) child.remove();
    }
  } else {
    block.clear();
    block.append($createTextNode(text));
  }
}

/** Append pre-built block node(s) at the end of the document. */
export function $appendBlock(...nodes: ElementNode[]): ElementNode[] {
  const root = $getRoot();
  for (const node of nodes) {
    root.append(node);
  }
  return nodes;
}

/** Prepend pre-built block node(s) at the top of the document. */
export function $prependBlock(...nodes: ElementNode[]): ElementNode[] {
  const root = $getRoot();
  const first = root.getFirstChild();
  if (!first) {
    for (const node of nodes) {
      root.append(node);
    }
    return nodes;
  }
  for (const node of nodes) {
    first.insertBefore(node);
  }
  return nodes;
}

/** Relocate a block to after/before another (by id). */
export function $moveBlock(
  block: LexicalNode,
  to: { placement: 'after' | 'before'; id: string },
  session?: LexicalSession
): void {
  // `to` id is resolved against the active editor state via key mappings if a
  // session is provided; otherwise the target is resolved by walking the root.
  const target = findTopLevelById(to.id, session);
  if (!target) {
    throw new Error(`No block with id "${to.id}"`);
  }
  block.remove();
  if (to.placement === 'after') {
    target.insertAfter(block);
  } else {
    target.insertBefore(block);
  }
}

function findTopLevelById(
  id: string,
  session?: LexicalSession
): ElementNode | null {
  if (session) {
    const key = session.ids.idToNodeKeyMap.get(id);
    if (key) {
      const node = $getNodeByKey(key);
      if (node && $isElementNode(node)) {
        return node;
      }
    }
  }
  for (const child of $getRoot().getChildren()) {
    if ($getId(child) === id && $isElementNode(child)) {
      return child;
    }
  }
  return null;
}

/**
 * Merge blocks into the first one (keeping its id). Inline content of later
 * blocks is appended, separated by `separator` (default `' '`). The later
 * blocks are removed.
 */
export function $mergeBlocks(
  blocks: LexicalNode[],
  separator = ' '
): ElementNode {
  const [first, ...rest] = blocks;
  if (!first || !$isElementNode(first)) {
    throw new Error('$mergeBlocks needs at least one block');
  }
  for (const node of rest) {
    if ($isElementNode(node)) {
      if (separator) {
        first.append($createTextNode(separator));
      }
      first.append(...node.getChildren());
    }
    node.remove();
  }
  return first;
}
