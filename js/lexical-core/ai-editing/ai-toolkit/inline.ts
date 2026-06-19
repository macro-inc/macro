import { $createLinkNode } from '@lexical/link';
import { $createMarkNode } from '@lexical/mark';
import {
  $createTextNode,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
  type TextNode,
} from 'lexical';
import { collectTextNodes } from './tree';

export type Scope = { nth?: number; all?: boolean };

const FORMAT_MAP: Record<string, TextFormatType> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  code: 'code',
};

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/**
 * Replace each matched occurrence of `needle` with constructed node(s).
 * Returns the count changed.
 */
export function $replaceTextInBlock(
  block: ElementNode,
  needle: string,
  make: () => LexicalNode | LexicalNode[],
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) => {
    const built = make();
    const nodes = Array.isArray(built) ? built : [built];
    let anchor: LexicalNode = matchNode;
    nodes.forEach((node, i) => {
      if (i === 0) {
        anchor.replace(node);
      } else {
        anchor.insertAfter(node);
      }
      anchor = node;
    });
  });
}

/** Format a substring (split the text node and set the format bit). */
export function $formatTextInBlock(
  block: ElementNode,
  needle: string,
  format: InlineFormat,
  scope?: Scope
): number {
  const fmt = FORMAT_MAP[format];
  return mutateMatches(block, needle, scope, (matchNode) => {
    if (!matchNode.hasFormat(fmt)) {
      matchNode.toggleFormat(fmt);
    }
  });
}

/** Remove formatting from a substring (omit `format` to clear all). */
export function $clearFormat(
  block: ElementNode,
  needle: string,
  format?: InlineFormat,
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) => {
    if (format) {
      const fmt = FORMAT_MAP[format];
      if (matchNode.hasFormat(fmt)) {
        matchNode.toggleFormat(fmt);
      }
    } else {
      matchNode.setFormat(0);
    }
  });
}

/** Set (or clear) formatting on every text node in a block. Omit `format` to strip all formatting. */
export function $setAllFormat(block: ElementNode, format?: InlineFormat): void {
  for (const node of collectTextNodes(block)) {
    if (format) {
      const fmt = FORMAT_MAP[format];
      if (!node.hasFormat(fmt)) node.toggleFormat(fmt);
    } else {
      node.setFormat(0);
    }
  }
}

/** Literal text replace, preserving formatting of the matched node. */
export function $replaceString(
  block: ElementNode,
  find: string,
  replace: string,
  scope?: Scope
): number {
  return mutateMatches(block, find, scope, (matchNode) => {
    matchNode.setTextContent(replace);
  });
}

/** Append plain text to the end of a block. */
export function $appendText(block: ElementNode, text: string): void {
  block.append($createTextNode(text));
}

/** Prepend plain text to the start of a block. */
export function $prependText(block: ElementNode, text: string): void {
  const node = $createTextNode(text);
  const first = block.getFirstChild();
  if (first) {
    first.insertBefore(node);
  } else {
    block.append(node);
  }
}

/**
 * Core inline-match engine. Finds occurrences of `needle` across the block's
 * text nodes, splits so each match is its own text node, then calls `apply` on
 * each matched node. Collects matches first, then mutates (mutating during the
 * walk would re-process freshly-created nodes). Returns the count changed.
 */
function mutateMatches(
  block: ElementNode,
  needle: string,
  scope: Scope | undefined,
  apply: (matchNode: TextNode) => void
): number {
  if (needle.length === 0) {
    return 0;
  }
  const all = scope?.all === true;
  // `nth` is 1-based per occurrence; default targets the first occurrence.
  const nth = scope?.nth;

  // 1) Collect every (textNode, offset) occurrence in document order.
  const occurrences: Array<{ node: TextNode; offset: number }> = [];
  for (const tn of collectTextNodes(block)) {
    const content = tn.getTextContent();
    let from = 0;
    let idx = content.indexOf(needle, from);
    while (idx !== -1) {
      occurrences.push({ node: tn, offset: idx });
      from = idx + needle.length;
      idx = content.indexOf(needle, from);
    }
  }
  if (occurrences.length === 0) {
    return 0;
  }

  // 2) Decide which occurrences to act on.
  let targets: Array<{ node: TextNode; offset: number }>;
  if (all) {
    targets = occurrences;
  } else if (nth != null) {
    const pick = occurrences[nth - 1];
    targets = pick ? [pick] : [];
  } else {
    targets = [occurrences[0]];
  }
  if (targets.length === 0) {
    return 0;
  }

  // 3) Group targets by their text node so we can split correctly. We process
  //    one text node at a time, splitting out each match into its own node.
  const byNode = new Map<TextNode, number[]>();
  for (const t of targets) {
    const list = byNode.get(t.node) ?? [];
    list.push(t.offset);
    byNode.set(t.node, list);
  }

  let count = 0;
  for (const [node, offsets] of byNode) {
    // Split the node at all match boundaries (offset and offset+len). Then the
    // substrings equal to `needle` are isolated nodes we can act on.
    const boundaries = new Set<number>();
    for (const off of offsets) {
      boundaries.add(off);
      boundaries.add(off + needle.length);
    }
    const sorted = [...boundaries].sort((a, b) => a - b);
    const pieces = node.splitText(...sorted);
    // After splitText, locate the pieces whose content === needle and that
    // started at one of our target offsets.
    for (const piece of pieces) {
      if (piece.getTextContent() === needle) {
        apply(piece);
        count++;
      }
    }
  }
  return count;
}

/** Wrap a matched substring in a link. Returns the count changed. */
export function $wrapInLink(
  block: ElementNode,
  needle: string,
  url: string,
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) => {
    const link = $createLinkNode(url);
    matchNode.replace(link);
    link.append(matchNode);
  });
}

/** Wrap a matched substring in a highlight (mark). Returns the count changed. */
export function $highlightInBlock(
  block: ElementNode,
  needle: string,
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) => {
    const mark = $createMarkNode();
    matchNode.replace(mark);
    mark.append(matchNode);
  });
}
