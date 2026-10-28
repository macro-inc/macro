/**
 * Placing and removing the comment mark an inline comment is anchored to.
 * Unlike `/edit`, nothing here is model-driven: the caller names the text and
 * the mark goes exactly there or nowhere, so a mark is never guessed into
 * place.
 */

import { $isCodeNode } from '@lexical/code';
import { $wrapSelectionInMarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import {
  $createCommentNode,
  $getCommentMarkContext,
  $isCommentNode,
  type CommentNode,
} from '@macro-inc/lexical-core';
import {
  $createRangeSelection,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';

/** Why a mark could not be placed; each is reported to the agent as is. */
export type AnchorRefusal =
  | 'not_found'
  | 'spans_blocks'
  | 'ambiguous'
  | 'occurrence_out_of_range';

export type AnchorResult =
  | { ok: true; markedText: string; surroundingText: string }
  | { ok: false; reason: AnchorRefusal; message: string };

type Segment =
  | { kind: 'text'; node: TextNode; start: number; end: number }
  | { kind: 'atom'; start: number; end: number };

type Occurrence = {
  block: ElementNode;
  start: { node: TextNode; offset: number };
  end: { node: TextNode; offset: number };
  context: string;
};

const CONTEXT_CHARS = 40;
const MAX_LISTED_OCCURRENCES = 5;

function $isTextBlock(node: LexicalNode): node is ElementNode {
  return (
    $isElementNode(node) &&
    !node.isInline() &&
    !$isCodeNode(node) &&
    node
      .getChildren()
      .some((child) => !$isElementNode(child) || child.isInline())
  );
}

/** The block's text as a reader sees it, with where each text node sits in it. */
function $blockText(block: ElementNode): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  let text = '';
  const visit = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      const content = node.getTextContent();
      segments.push({
        kind: 'text',
        node,
        start: text.length,
        end: text.length + content.length,
      });
      text += content;
    } else if ($isLineBreakNode(node)) {
      text += '\n';
    } else if ($isElementNode(node) && node.isInline()) {
      for (const child of node.getChildren()) visit(child);
    } else if ($isDecoratorNode(node)) {
      const content = node.getTextContent();
      segments.push({
        kind: 'atom',
        start: text.length,
        end: text.length + content.length,
      });
      text += content;
    }
  };
  for (const child of block.getChildren()) visit(child);
  return { text, segments };
}

/** A text point at `offset`, `edge` saying which side of a node boundary it prefers. */
function pointAt(
  segments: Segment[],
  offset: number,
  edge: 'start' | 'end'
): { node: TextNode; offset: number } | null {
  for (const segment of segments) {
    if (segment.kind !== 'text') continue;
    const inside =
      edge === 'start'
        ? offset >= segment.start && offset < segment.end
        : offset > segment.start && offset <= segment.end;
    if (inside) return { node: segment.node, offset: offset - segment.start };
  }
  return null;
}

function contextAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  return (
    (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '')
  );
}

function $occurrences(needle: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const { node } of $dfs($getRoot())) {
    if (!$isTextBlock(node)) continue;
    const { text, segments } = $blockText(node);
    for (
      let index = text.indexOf(needle);
      index !== -1;
      index = text.indexOf(needle, index + needle.length)
    ) {
      const start = pointAt(segments, index, 'start');
      const end = pointAt(segments, index + needle.length, 'end');
      // A match that begins or ends inside a mention or other atom cannot be
      // wrapped exactly, so it is not a place the mark can go.
      if (!start || !end) continue;
      out.push({
        block: node,
        start,
        end,
        context: contextAround(text, index, index + needle.length),
      });
    }
  }
  return out;
}

function $blockTexts(): string[] {
  const blocks: string[] = [];
  for (const { node } of $dfs($getRoot())) {
    if ($isTextBlock(node)) blocks.push($blockText(node).text);
  }
  return blocks;
}

/**
 * Wrap the `occurrence`th (1-based) appearance of `text` in a committed comment
 * mark `markId`. Refuses rather than guesses: text that is not in the
 * document, that crosses from one block into another, or that appears more
 * than once with no occurrence chosen leaves the document untouched, as does
 * a mark `markId` the document already carries. Must run
 * inside an editor update.
 */
export function $addCommentMark(
  markId: string,
  text: string,
  occurrence?: number
): AnchorResult {
  // A retried request finds its mark already placed; wrapping again would
  // nest the mark inside itself.
  const placed = $getCommentMarkContext(markId);
  if (placed) return { ok: true, ...placed };

  const needle = text.trim();
  const found = needle ? $occurrences(needle) : [];

  if (found.length === 0) {
    // Only text that is in no single block but runs across the join of two is
    // reported as crossing blocks; a whitespace slip inside one block is not.
    const collapse = (value: string) => value.replace(/\s+/g, ' ');
    const quote = collapse(needle);
    const blocks = $blockTexts().map(collapse);
    if (
      needle &&
      !blocks.some((block) => block.includes(quote)) &&
      collapse(blocks.join(' ')).includes(quote)
    )
      return {
        ok: false,
        reason: 'spans_blocks',
        message:
          'The text runs across more than one paragraph, heading, list item or table cell. An inline comment covers text within one of them: choose a passage inside a single block.',
      };
    return {
      ok: false,
      reason: 'not_found',
      message:
        'The text was not found in the document. Quote it exactly as the document reads, including its spacing and line breaks, without markdown syntax such as ** or links, and read the document again if it may have changed.',
    };
  }

  if (occurrence !== undefined && (occurrence < 1 || occurrence > found.length))
    return {
      ok: false,
      reason: 'occurrence_out_of_range',
      message: `The text appears ${found.length} time(s); occurrence ${occurrence} does not exist.`,
    };

  if (occurrence === undefined && found.length > 1) {
    const listed = found
      .slice(0, MAX_LISTED_OCCURRENCES)
      .map((match, index) => `${index + 1}: "${match.context}"`)
      .join('\n');
    const more =
      found.length > MAX_LISTED_OCCURRENCES
        ? `\n(and ${found.length - MAX_LISTED_OCCURRENCES} more)`
        : '';
    return {
      ok: false,
      reason: 'ambiguous',
      message: `The text appears ${found.length} times. Pass the occurrence to comment on, or quote a longer, unique passage:\n${listed}${more}`,
    };
  }

  const target = found[(occurrence ?? 1) - 1];
  const selection = $createRangeSelection();
  selection.anchor.set(target.start.node.getKey(), target.start.offset, 'text');
  selection.focus.set(target.end.node.getKey(), target.end.offset, 'text');
  $wrapSelectionInMarkNode(selection, false, markId, (ids) =>
    $createCommentNode({ ids, isDraft: false })
  );

  const context = $getCommentMarkContext(markId);
  if (!context)
    throw new Error(`comment mark ${markId} missing right after it was placed`);
  return { ok: true, ...context };
}

/**
 * Take comment mark `markId` out of the document, keeping the text it
 * covered. Returns whether the document carried it. Must run inside an editor
 * update.
 */
export function $removeCommentMark(markId: string): boolean {
  const marks: CommentNode[] = [];
  for (const { node } of $dfs($getRoot())) {
    if ($isCommentNode(node) && node.getIDs().includes(markId))
      marks.push(node);
  }
  for (const mark of marks) {
    if (mark.getIDs().length > 1) {
      mark.deleteID(markId);
      continue;
    }
    for (const child of mark.getChildren()) mark.insertBefore(child);
    mark.remove();
  }
  return marks.length > 0;
}
