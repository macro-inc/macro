/**
 * Direct edits applied, in order, to a document's block list. The result is
 * the requested block list the committer reconciles into the document.
 */
import {
  type DocumentBlock,
  type DocumentView,
  keepPlaceholder,
  parseMarkdown,
  type SerializedNode,
} from './document';
import { FrozenMediaError, redactMedia, restoreMedia } from './media';

/** A block id, or the start or end of the document. */
export type Position = string;

export type DirectEdit =
  | { block_id?: string; old: string; new: string; replace_all?: boolean }
  | { insert_after: Position; markdown: string }
  | { insert_before: Position; markdown: string }
  | { delete: string }
  | { move: string; after: string }
  | { move: string; before: string };

export type RefusalCode =
  | 'no_match'
  | 'ambiguous_match'
  | 'unknown_block'
  | 'empty_edit'
  | 'unparseable'
  | 'opaque_edit'
  | 'comment_loss'
  | 'mass_delete'
  | 'markup_leak'
  | 'frozen_media'
  | 'too_large'
  | 'verify_failed';

/** A block an ambiguous or missing `old` might have meant. */
export interface Candidate {
  blockId: string;
  /** How often `old` occurs in this block (0 for a no-match suggestion). */
  occurrences: number;
  /** The block's markdown as the edit saw it. */
  markdown: string;
}

/**
 * Why a batch was not applied; the document is untouched. `message` may quote
 * document text: it is for the caller, never for logs or span fields.
 */
export class EditRefusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
    readonly edit?: number,
    readonly candidates?: Candidate[]
  ) {
    super(message);
    this.name = 'EditRefusal';
  }
}

/** One requested top-level block: new markdown, or a base block kept by id. */
export type RequestedBlock =
  | {
      kind: 'markdown';
      node: SerializedNode;
      markdown: string;
      /** The base block this one was edited from. */
      hint?: string;
      /** Base blocks an edit spanning several blocks merged into this one. */
      hints?: string[];
    }
  | { kind: 'keep'; id: string };

interface Entry {
  /** Base block id, while this entry is still a base block. */
  id?: string;
  markdown: string;
  /** The markdown it started as, to tell whether it changed. */
  baseMarkdown?: string;
  opaque: boolean;
  hints?: string[];
}

const MAX_CANDIDATES = 5;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at >= 0;
    at = haystack.indexOf(needle, at + needle.length)
  )
    count++;
  return count;
}

const words = (text: string) =>
  new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Word Jaccard similarity. */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

function indexOfId(list: Entry[], id: string, edit: number): number {
  const i = list.findIndex((entry) => entry.id === id);
  if (i < 0)
    throw new EditRefusal(
      'unknown_block',
      `edit ${edit}: no block with id ${id}`,
      edit
    );
  return i;
}

function insertionIndex(
  list: Entry[],
  where: Position,
  before: boolean,
  edit: number
): number {
  if (where === 'start') return 0;
  if (where === 'end') return list.length;
  const i = indexOfId(list, where, edit);
  return before ? i : i + 1;
}

/** Blocks most like `old`, for a no-match refusal. */
function nearest(list: Entry[], old: string): Candidate[] {
  return list
    .filter((entry) => entry.id !== undefined && !entry.opaque)
    .map((entry) => ({ entry, score: similarity(entry.markdown, old) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ entry }) => ({
      blockId: entry.id,
      occurrences: 0,
      markdown: entry.markdown,
    }));
}

/**
 * `old` across a block boundary (blocks are joined by one blank line, as the
 * agent reads them): the spanned range and the match offsets inside it.
 */
function crossBlockMatch(list: Entry[], old: string, edit: number) {
  if (!old.includes('\n')) return null;
  const offsets: number[] = [];
  let joined = '';
  list.forEach((entry, i) => {
    if (i) joined += '\n\n';
    offsets.push(joined.length);
    joined += entry.markdown;
  });
  const at = joined.indexOf(old);
  if (at < 0) return null;
  if (joined.indexOf(old, at + 1) >= 0)
    throw new EditRefusal(
      'ambiguous_match',
      `edit ${edit}: old occurs several times across blocks; include more surrounding text`,
      edit
    );
  const end = at + old.length;
  let first = 0;
  while (
    first < list.length - 1 &&
    offsets[first] + list[first].markdown.length < at
  )
    first++;
  let last = list.length - 1;
  // A match that starts or ends in a separator takes the block beside it.
  while (last > 0 && offsets[last] > end) last--;
  const merged = joined.slice(
    offsets[first],
    offsets[last] + list[last].markdown.length
  );
  return {
    first,
    last,
    merged,
    start: at - offsets[first],
    end: end - offsets[first],
  };
}

function applyReplace(
  list: Entry[],
  edit: Extract<DirectEdit, { old: string }>,
  n: number
): void {
  if (typeof edit.old !== 'string' || typeof edit.new !== 'string')
    throw new EditRefusal(
      'unparseable',
      `edit ${n}: old and new must be strings`,
      n
    );
  if (edit.old === '')
    throw new EditRefusal(
      'empty_edit',
      `edit ${n}: old is empty; use insert_after or insert_before to add content`,
      n
    );
  const scope = edit.block_id
    ? [indexOfId(list, edit.block_id, n)]
    : list.map((_, i) => i);
  const hits = scope
    .map((i) => ({ i, count: occurrences(list[i].markdown, edit.old) }))
    .filter((hit) => hit.count > 0);
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  if (total === 0 && !edit.block_id) {
    const span = crossBlockMatch(list, edit.old, n);
    if (span) {
      for (let i = span.first; i <= span.last; i++)
        if (list[i].opaque)
          throw new EditRefusal(
            'opaque_edit',
            `edit ${n}: the text spans block ${list[i].id}, which cannot be edited as text; edit around it`,
            n
          );
      const hints = list
        .slice(span.first, span.last + 1)
        .flatMap((entry) => (entry.id !== undefined ? [entry.id] : []));
      list.splice(span.first, span.last - span.first + 1, {
        markdown:
          span.merged.slice(0, span.start) +
          edit.new +
          span.merged.slice(span.end),
        opaque: false,
        hints,
      });
      return;
    }
  }
  if (total === 0) {
    const where = edit.block_id
      ? `in block ${edit.block_id}`
      : 'in the document';
    throw new EditRefusal(
      'no_match',
      `edit ${n}: old does not occur ${where}; copy it exactly from the block's markdown`,
      n,
      edit.block_id
        ? [
            {
              blockId: edit.block_id,
              occurrences: 0,
              markdown: list[scope[0]].markdown,
            },
          ]
        : nearest(list, edit.old)
    );
  }
  if (total > 1 && !edit.replace_all)
    throw new EditRefusal(
      'ambiguous_match',
      `edit ${n}: old occurs ${total} times; add block_id, include more surrounding text, or set replace_all`,
      n,
      hits.slice(0, MAX_CANDIDATES).map((hit) => ({
        blockId: list[hit.i].id ?? '(a block this batch inserted)',
        occurrences: hit.count,
        markdown: list[hit.i].markdown,
      }))
    );
  for (const hit of hits) {
    const entry = list[hit.i];
    if (entry.opaque)
      throw new EditRefusal(
        'opaque_edit',
        `edit ${n}: block ${entry.id} holds content markdown cannot show; it can only be moved or deleted`,
        n
      );
    entry.markdown = entry.markdown.split(edit.old).join(edit.new);
  }
}

/**
 * Apply `edits` in order to the block list. Throws an {@link EditRefusal} on
 * the first edit that cannot apply, so a batch applies whole or not at all.
 */
export function applyEdits(
  blocks: DocumentBlock[],
  edits: DirectEdit[]
): Entry[] {
  const list: Entry[] = blocks.map((block) => {
    const markdown = block.opaque
      ? keepPlaceholder(block.id)
      : redactMedia(block.markdown);
    return {
      id: block.id,
      markdown,
      baseMarkdown: markdown,
      opaque: block.opaque,
    };
  });
  if (edits.length === 0) throw new EditRefusal('empty_edit', 'edits is empty');
  edits.forEach((edit, k) => {
    const n = k + 1;
    if ('old' in edit) applyReplace(list, edit, n);
    else if ('insert_after' in edit || 'insert_before' in edit) {
      const before = 'insert_before' in edit;
      const where = before ? edit.insert_before : edit.insert_after;
      if (!edit.markdown.trim())
        throw new EditRefusal('empty_edit', `edit ${n}: markdown is empty`, n);
      list.splice(insertionIndex(list, where, before, n), 0, {
        markdown: edit.markdown,
        opaque: false,
      });
    } else if ('delete' in edit) {
      list.splice(indexOfId(list, edit.delete, n), 1);
    } else {
      const target = 'after' in edit ? edit.after : edit.before;
      if (target === edit.move)
        throw new EditRefusal(
          'unknown_block',
          `edit ${n}: a block cannot move relative to itself`,
          n
        );
      const [moved] = list.splice(indexOfId(list, edit.move, n), 1);
      list.splice(insertionIndex(list, target, 'before' in edit, n), 0, moved);
    }
  });
  return list.filter(
    (entry) => entry.id !== undefined || entry.markdown.trim() !== ''
  );
}

/** Count `<m-…>` opening tags per tag name. */
function tagCounts(markdown: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, tag] of markdown.matchAll(/<(m-[a-z-]+)[\s>]/g))
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
}

function isUnknownNode(node: SerializedNode): boolean {
  if (node.type.startsWith('unknown')) return true;
  return (node.children ?? []).some(isUnknownNode);
}

/**
 * Parse an edited block, refusing when the parser silently drops internal
 * markup: a `<m-…>` tag (mention, table cell, equation…) that occurs fewer
 * times in the canonical render than in the source.
 */
function parseChecked(markdown: string) {
  const parsed = parseMarkdown(markdown);
  const source = tagCounts(markdown);
  const rendered = tagCounts(parsed.markdowns.join('\n\n'));
  for (const [tag, count] of source)
    if ((rendered.get(tag) ?? 0) < count)
      throw new EditRefusal(
        'unparseable',
        `<${tag}> markup did not parse (malformed JSON or XML); fix it and try again`
      );
  return parsed;
}

/** Edited entries as requested blocks: untouched base blocks are kept by id. */
export function toRequested(
  view: DocumentView,
  list: Entry[],
  media: Map<string, string>
): RequestedBlock[] {
  const baseMarkdowns = new Set(view.blocks.map((block) => block.markdown));
  const requested: RequestedBlock[] = [];
  for (const entry of list) {
    if (entry.id !== undefined && entry.markdown === entry.baseMarkdown) {
      requested.push({ kind: 'keep', id: entry.id });
      continue;
    }
    if (!entry.markdown.trim()) continue; // all its text replaced away: deleted
    let restored: string;
    try {
      restored = restoreMedia(entry.markdown, media);
    } catch (error) {
      if (error instanceof FrozenMediaError)
        throw new EditRefusal('frozen_media', error.message);
      throw error;
    }
    const { nodes, markdowns } = parseChecked(restored);
    nodes.forEach((node, i) => {
      if (isUnknownNode(node) && !baseMarkdowns.has(markdowns[i]))
        throw new EditRefusal(
          'unparseable',
          'a block holds markup that did not parse (malformed <m-…> tag JSON or table XML)'
        );
      requested.push({
        kind: 'markdown',
        node,
        markdown: markdowns[i],
        ...(entry.id !== undefined ? { hint: entry.id } : {}),
        ...(entry.hints ? { hints: entry.hints } : {}),
      });
    });
  }
  return requested;
}

/** The requested markdown of each block, keep tokens resolved. */
export function requestedMarkdown(
  view: DocumentView,
  requested: RequestedBlock[]
): string[] {
  const byId = new Map(view.blocks.map((block) => [block.id, block]));
  return requested.map((block) =>
    block.kind === 'keep' ? byId.get(block.id).markdown : block.markdown
  );
}
