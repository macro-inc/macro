import {
  $convertToMarkdownString,
  type TextFormatTransformer,
} from '@lexical/markdown';
import { $isHeadingNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isRootNode,
  $isTextNode,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';
import { $getId } from '../../../lexical-core/plugins/nodeIdPlugin';
import { EXTERNAL_TRANSFORMERS } from '../../../lexical-core/transformers';
import { toXml } from '../../../lexical-core/transformers/xml';
import { createEditingSession, loadSnapshot, type Session } from './ai-toolkit';

const UNDERLINE_FORMAT: TextFormatTransformer = {
  format: ['underline'],
  tag: '__',
  type: 'text-format',
};

const AI_TRANSFORMERS = [UNDERLINE_FORMAT, ...EXTERNAL_TRANSFORMERS];

function nodeLabel(node: LexicalNode): string {
  return `{${$getId(node) ?? '?'}|${node.getType()}}`;
}

/**
 * Append a ` {id|type}` marker to a node. Block-level elements get it appended to
 * their inline content; opaque leaves (equation, image) get it as a trailing
 * sibling; a table gets a trailing marker line. Pure structural containers
 * (list, table row) carry no marker of their own; their children do.
 */
function annotate(node: LexicalNode): void {
  if ($isElementNode(node)) {
    const type = node.getType();

    if (type === 'table') {
      // A table can't hold inline text, so mark it with a trailing line and
      // don't descend into its rows/cells.
      const marker = $createParagraphNode();
      marker.append($createTextNode(nodeLabel(node)));
      node.insertAfter(marker);
      return;
    }

    for (const child of node.getChildren()) annotate(child);

    // Structural containers (list, table row) and inline elements (links, …)
    // carry no marker of their own — their block children do.
    if (!node.isInline() && type !== 'list' && type !== 'tablerow') {
      node.append($createTextNode(` ${nodeLabel(node)}`));
    }
    return;
  }

  if (!$isTextNode(node) && !$isLineBreakNode(node)) {
    const parent = node.getParent();
    if (parent !== null && $isRootNode(parent)) {
      // Can't insert a bare text node into root — wrap it in a paragraph.
      const marker = $createParagraphNode();
      marker.append($createTextNode(nodeLabel(node)));
      node.insertAfter(marker);
    } else {
      node.insertAfter($createTextNode(` ${nodeLabel(node)}`));
    }
  }
}

/**
 * Serialize the document to markdown with `{id|type}` markers — the text the
 * model reads and locks onto.
 */
export function serializeSnapshotWithIds(
  snapshot: SerializedEditorState
): string {
  const tmp = createEditingSession();
  loadSnapshot(tmp, snapshot);
  tmp.editor.update(
    () => {
      for (const child of $getRoot().getChildren()) {
        // HeadingNodes with a null tag (corrupt Loro sync state) crash markdown export.
        if ($isHeadingNode(child) && child.getTag() == null) {
          const p = $createParagraphNode();
          p.append(...child.getChildren());
          child.replace(p);
        }
      }
      for (const child of $getRoot().getChildren()) annotate(child);
    },
    { discrete: true }
  );
  const md = tmp.editor
    .getEditorState()
    .read(() => $convertToMarkdownString(AI_TRANSFORMERS));
  const cleaned = md.replace(
    /\{([A-Za-z0-9_\\-]+)\|([a-z]+)\}/g,
    (_m, id: string, type: string) => `{${id.replace(/\\/g, '')}|${type}}`
  );
  return numberLines(cleaned);
}

/** Lines of context kept on each side of a relevant node when windowing for a writer. */
export const WINDOW_PADDING = 6;

/** Prefix each line with a 1-indexed `N | ` gutter -- the line addressing the agents read. */
export function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n');
}

export function serializeWithIds(s: Session): string {
  return serializeSnapshotWithIds(s.editor.getEditorState().toJSON());
}

/**
 * Return the line-numbered serialization sliced to the given line range
 * (1-indexed, inclusive), with `padding` extra lines on each side for context.
 */
export function serializeWindowByLines(
  s: Session,
  lineStart: number,
  lineEnd: number,
  padding = 10
): string {
  const lines = serializeWithIds(s).split('\n');
  const lo = Math.max(0, lineStart - 1 - padding);
  const hi = Math.min(lines.length - 1, lineEnd - 1 + padding);
  return lines.slice(lo, hi + 1).join('\n');
}

/** Just the heading lines with line numbers — a lightweight map for the supervisor. */
export function serializeHeadings(s: Session): string {
  return serializeWithIds(s)
    .split('\n')
    .filter((l) => /^\d+ \| #{1,6} /.test(l))
    .join('\n');
}

function stripMarkers(s: string): string {
  return s.replace(/[*_`~#>]|__|\{[^}]+\}/g, '').trim();
}

/**
 * Fuzzy find: word-overlap score against stripped lines, returns up to 3 matching
 * regions with surrounding context lines.
 */
export function findInDocument(
  s: Session,
  needle: string,
  contextLines = 5
): string {
  const allLines = serializeWithIds(s).split('\n');
  const words = stripMarkers(needle).toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '(no needle provided)';

  const hits = allLines
    .map((line, i) => {
      const clean = stripMarkers(line).toLowerCase();
      const score =
        words.filter((w) => clean.includes(w)).length / words.length;
      return { i, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (hits.length === 0) return '(no matches)';

  return hits
    .map(({ i }) => {
      const lo = Math.max(0, i - contextLines);
      const hi = Math.min(allLines.length - 1, i + contextLines);
      return allLines.slice(lo, hi + 1).join('\n');
    })
    .join('\n---\n');
}

export function serializeWithXml(s: Session): string {
  return toXml(s.editor.getEditorState().toJSON());
}

/**
 * Line-numbered XML windowed to the regions a writer needs: ±`padding` lines
 * around each node whose id is listed (matched on its `id="…"` opening tag).
 * Overlapping windows merge; non-contiguous ones are joined with a `…` gap
 * marker so the writer knows lines were omitted. A big block (long table/list)
 * is only partially covered -- list its child ids to widen the window.
 */
export function serializeWindowByIds(
  s: Session,
  ids: string[],
  padding = WINDOW_PADDING
): string {
  const lines = numberLines(serializeWithXml(s)).split('\n');
  const hits = ids
    .map((id) => lines.findIndex((l) => l.includes(`id="${id}"`)))
    .filter((i) => i !== -1);
  if (hits.length === 0) return '(no matching node ids found)';

  const ranges = hits
    .map(
      (i) =>
        [Math.max(0, i - padding), Math.min(lines.length - 1, i + padding)] as [
          number,
          number,
        ]
    )
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of ranges) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged
    .map(([lo, hi]) => lines.slice(lo, hi + 1).join('\n'))
    .join('\n…\n');
}
