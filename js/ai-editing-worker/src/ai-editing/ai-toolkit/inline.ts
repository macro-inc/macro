import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $createMarkNode, $isMarkNode } from '@lexical/mark';
import {
  $createTextNode,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
  type TextNode,
} from 'lexical';
import { collectTextNodes } from './tree';

export type Scope = { kind: 'nth'; n: number } | { kind: 'all' };

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

/** Strip all inline formatting (bold, italic, underline, etc.) from every text node in a block. */
export function $stripFormat(block: ElementNode): void {
  for (const node of collectTextNodes(block)) {
    node.setFormat(0);
  }
}

/**
 * Literal text replace. Mutates matched text nodes IN PLACE (via
 * `setTextContent`) so their durable ids survive — the diff then sees a clean
 * `setText{from,to}` instead of node churn, which is what lets the replay
 * highlight/animate the exact changed span. Like the formatting helpers it
 * works per text node, so a needle straddling two nodes isn't matched.
 */
// TODO(wolf): unreliable on code blocks -- their children are per-token
// code-highlight nodes, so a `find` can span a Prism token boundary
export function $replaceString(
  block: ElementNode,
  find: string,
  replace: string,
  scope?: Scope
): number {
  if (find.length === 0) return 0;
  const all = scope?.kind === 'all';
  const nth = scope?.kind === 'nth' ? scope.n : undefined;
  let occ = 0; // global, 1-based occurrence counter across the block's text nodes
  let count = 0;
  for (const tn of collectTextNodes(block)) {
    const content = tn.getTextContent();
    if (!content.includes(find)) continue;
    let next = '';
    let i = 0;
    let changed = false;
    while (i < content.length) {
      if (content.startsWith(find, i)) {
        occ++;
        const take = all || (nth == null ? occ === 1 : occ === nth);
        if (take) {
          next += replace;
          changed = true;
          count++;
        } else {
          next += find;
        }
        i += find.length;
      } else {
        next += content[i];
        i++;
      }
    }
    if (!changed) continue;
    if (next.length === 0) tn.remove();
    else tn.setTextContent(next);
  }
  return count;
}

/** Append plain text to the end of a block. Extends the trailing plain text node
 *  in place (preserving its id) when possible, else adds a new node. */
export function $appendText(block: ElementNode, text: string): void {
  const last = block.getLastChild();
  if ($isTextNode(last) && last.getFormat() === 0) {
    last.setTextContent(last.getTextContent() + text);
  } else {
    block.append($createTextNode(text));
  }
}

/** Prepend plain text to the start of a block. Extends the leading plain text
 *  node in place (preserving its id) when possible, else adds a new node. */
export function $prependText(block: ElementNode, text: string): void {
  const first = block.getFirstChild();
  if ($isTextNode(first) && first.getFormat() === 0) {
    first.setTextContent(text + first.getTextContent());
  } else if (first) {
    first.insertBefore($createTextNode(text));
  } else {
    block.append($createTextNode(text));
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
  const all = scope?.kind === 'all';
  // `nth` is 1-based per occurrence; default targets the first occurrence.
  const nth = scope?.kind === 'nth' ? scope.n : undefined;

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
    // Walk pieces by cumulative character position so we can identify target
    // pieces by offset — content equality alone is ambiguous when needle repeats.
    const targetOffsets = new Set(offsets);
    let pos = 0;
    for (const piece of pieces) {
      const len = piece.getTextContent().length;
      if (targetOffsets.has(pos) && piece.getTextContent() === needle) {
        apply(piece);
        count++;
      }
      pos += len;
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

function $unwrapWrapper(
  matchNode: TextNode,
  pred: (n: LexicalNode) => boolean
): void {
  let parent: LexicalNode | null = matchNode.getParent();
  while (parent && !pred(parent)) parent = parent.getParent();
  if (!parent || !$isElementNode(parent)) return;
  for (const child of parent.getChildren()) parent.insertBefore(child);
  parent.remove();
}

/** Remove the link wrapper from a matched substring. Returns the count changed. */
export function $unwrapFromLink(
  block: ElementNode,
  needle: string,
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) =>
    $unwrapWrapper(matchNode, $isLinkNode)
  );
}

/** Remove the highlight (mark) wrapper from a matched substring. Returns the count changed. */
export function $unhighlightInBlock(
  block: ElementNode,
  needle: string,
  scope?: Scope
): number {
  return mutateMatches(block, needle, scope, (matchNode) =>
    $unwrapWrapper(matchNode, $isMarkNode)
  );
}
