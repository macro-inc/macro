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
  type TextNode,
} from 'lexical';
import { match } from 'ts-pattern';
import { $getId, $setId, type NodeIdMappings } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { $isCustomCodeNode } from '../../../../lexical-core/nodes/CustomCodeNode';
import type { Session } from './session';
import { collectTextNodes } from './tree';

export type BlockData =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number }
  | { type: 'quote' }
  | { type: 'code'; language?: string };

export type BlockType = BlockData['type'];

function $transferId(node: LexicalNode, id: string, mappings: NodeIdMappings): void {
  $setId(node, id);
  mappings.idToNodeKeyMap.set(id, node.getKey());
  mappings.nodeKeyToIdMap.set(node.getKey(), id);
}

/** Build an (empty) block node to pass to `$setBlockType` / inserts. */
export function $blockNode(data: BlockData): ElementNode {
  return match(data)
    .returnType<ElementNode>()
    .with({ type: 'heading' }, (d) => $createHeadingNode(`h${d.level}` as HeadingTagType))
    .with({ type: 'quote' }, () => $createQuoteNode())
    .with({ type: 'code' }, (d) => $createCodeNode(d.language))
    .with({ type: 'paragraph' }, () => $createParagraphNode())
    .exhaustive();
}

/**
 * Change a block's type, keeping its text content and durable id. The new
 * block's children are transplanted from the old one and the old id is
 * re-applied so it survives the replacement.
 */
export function $setBlockType(
  s: Session,
  block: ElementNode,
  make: () => ElementNode
): ElementNode {
  const oldId = $getId(block);
  const replacement = make();
  block.replace(replacement, true);
  if (oldId) {
    $transferId(replacement, oldId, s.ids);
  }
  return replacement;
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
  const existing = children.find($isTextNode) as TextNode | undefined;
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

/**
 * Replace a block entirely with pre-built node(s). The first node takes the
 * original block's position; subsequent nodes follow it. Returns the new nodes.
 */
export function $replaceBlock(
  block: ElementNode,
  ...nodes: ElementNode[]
): ElementNode[] {
  if (nodes.length === 0) {
    block.remove();
    return [];
  }
  let anchor: LexicalNode = block;
  const [first, ...rest] = nodes;
  block.replace(first);
  anchor = first;
  for (const node of rest) {
    anchor.insertAfter(node);
    anchor = node;
  }
  return nodes;
}

/** Insert pre-built block node(s) after `block`. */
export function $insertAfter(
  block: ElementNode,
  ...nodes: ElementNode[]
): ElementNode[] {
  let anchor: LexicalNode = block;
  for (const node of nodes) {
    anchor.insertAfter(node);
    anchor = node;
  }
  return nodes;
}

/** Insert pre-built block node(s) before `block`. */
export function $insertBefore(
  block: ElementNode,
  ...nodes: ElementNode[]
): ElementNode[] {
  for (const node of nodes) {
    block.insertBefore(node);
  }
  return nodes;
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
  to: { afterId?: string; beforeId?: string },
  s?: Session
): void {
  // `to` ids are resolved against the active editor state via key mappings if a
  // session is provided; otherwise the target is resolved by walking the root.
  const targetId = to.afterId ?? to.beforeId;
  if (!targetId) {
    throw new Error('$moveBlock requires { afterId } or { beforeId }');
  }
  const target = findTopLevelById(targetId, s);
  if (!target) {
    throw new Error(`No block with id "${targetId}"`);
  }
  block.remove();
  if (to.afterId) {
    target.insertAfter(block);
  } else {
    target.insertBefore(block);
  }
}

function findTopLevelById(id: string, s?: Session): ElementNode | null {
  if (s) {
    const key = s.ids.idToNodeKeyMap.get(id);
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

/**
 * Split a block into two at the first occurrence of `atText`. The text starting
 * at `atText` moves into a new sibling block of the same type. Returns
 * `[first, second]`.
 */
export function $splitBlock(
  block: ElementNode,
  atText: string
): [ElementNode, ElementNode] {
  const second = cloneEmptyBlock(block);

  // Find the text node and offset where `atText` begins.
  const texts = collectTextNodes(block);
  let found: { node: TextNode; offset: number } | null = null;
  for (const tn of texts) {
    const idx = tn.getTextContent().indexOf(atText);
    if (idx !== -1) {
      found = { node: tn, offset: idx };
      break;
    }
  }
  if (!found) {
    throw new Error(`"${atText}" not found in block`);
  }

  // Split the matched text node so the match starts a fresh node.
  let splitNode = found.node;
  if (found.offset > 0) {
    const parts = found.node.splitText(found.offset);
    splitNode = parts[parts.length - 1];
  }

  // Move splitNode and everything after it (within the block) into `second`.
  const moving: LexicalNode[] = [];
  let cursor: LexicalNode | null = splitNode;
  while (cursor) {
    moving.push(cursor);
    cursor = cursor.getNextSibling();
  }
  block.insertAfter(second);
  second.append(...moving);
  return [block, second];
}

function cloneEmptyBlock(block: ElementNode): ElementNode {
  // Build a same-typed empty block. We reuse the markdown-free constructors.
  const type = block.getType();
  if (type === 'heading') {
    const tag = (block as ReturnType<typeof $createHeadingNode>).getTag();
    return $createHeadingNode(tag);
  }
  if (type === 'quote') {
    return $createQuoteNode();
  }
  if (type === 'code' || type === 'custom-code') {
    const lang = (block as ReturnType<typeof $createCodeNode>).getLanguage() ?? undefined;
    return $createCodeNode(lang);
  }
  return $createParagraphNode();
}
