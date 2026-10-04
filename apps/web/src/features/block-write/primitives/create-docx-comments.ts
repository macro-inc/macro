import type { PageRect, ParagraphText, Pos } from '@core/docx-engine/types';
import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  type CommentMark,
  deleteCommentMark,
  MAX_MARK_TEXT,
  readCommentMarks,
  resolveMark,
  writeCommentMark,
} from '../core/comment-marks';
import { DOCX_LORO_CONTAINERS } from '../core/docx-loro';

export type DocxCommentDraft = { markId: string; mark: CommentMark };

export type LocatedThread = {
  /** Thread root id, or the draft's mark id. */
  id: string;
  markId: string;
  root: MessageListItem | null;
  resolved: boolean;
  /** Where the commented text is, as found in the current document. */
  mark: CommentMark;
  /** Its highlight rectangles on the pages. */
  rects: PageRect[];
};

/** A placeholder mark for a thread known only by its quoted text. */
function quotedMark(root: MessageListItem): CommentMark | null {
  const anchor = root.state.anchor;
  const text =
    anchor && anchor.type === 'markdown' ? anchor.marked_text?.trim() : null;
  return text ? { block: '', start: 0, length: text.length, text } : null;
}

/** The mark id a thread is anchored to, when it is a text anchor. */
export function threadMarkId(root: MessageListItem): string | null {
  const anchor = root.state.anchor;
  return anchor && anchor.type === 'markdown' ? anchor.mark_id : null;
}

/** What comment placement needs from the editor. */
export type CommentGeometry = {
  revision: Accessor<number>;
  paragraphs: () => Promise<ParagraphText[]>;
  rangeRects: (from: Pos, to: Pos) => Promise<PageRect[]>;
  /** The current selection, in document order. */
  selection: () => { from: Pos; to: Pos } | undefined;
};

/**
 * Comment anchoring for a DOCX: marks live in the collaborative document,
 * threads come from the shared message store, and both are joined to the
 * text the engine currently lays out.
 */
export function createDocxComments(options: {
  doc: LoroDoc | null;
  roots: Accessor<MessageListItem[]>;
  geometry: CommentGeometry;
  canEdit: Accessor<boolean>;
}) {
  const [marks, setMarks] = createSignal<Map<string, CommentMark>>(
    options.doc ? readCommentMarks(options.doc) : new Map()
  );
  const [draft, setDraft] = createSignal<DocxCommentDraft>();
  const [active, setActive] = createSignal<string | null>(null);
  const [paragraphs, setParagraphs] = createSignal<ParagraphText[]>([]);
  const [located, setLocated] = createSignal<LocatedThread[]>([]);

  if (options.doc) {
    const doc = options.doc;
    const unsubscribe = doc
      .getMap(DOCX_LORO_CONTAINERS.marks)
      .subscribe(() => setMarks(readCommentMarks(doc)));
    onCleanup(unsubscribe);
  }

  const live = (root: MessageListItem) => !root.state.deleted_at;

  // The engine's text: refreshed shortly after the document changes.
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(options.geometry.revision, () => {
      clearTimeout(textTimer);
      textTimer = setTimeout(() => {
        options.geometry
          .paragraphs()
          .then(setParagraphs)
          .catch(() => {});
      }, 120);
    })
  );
  onCleanup(() => clearTimeout(textTimer));

  /** Marks resolved against the current text. */
  const placement = createMemo(() => {
    const blocks = paragraphs();
    const all = marks();
    const out: Array<Omit<LocatedThread, 'rects'>> = [];
    const relocations: Array<[string, CommentMark]> = [];
    if (!blocks.length) return { threads: out, relocations };
    const place = (
      id: string,
      markId: string,
      mark: CommentMark,
      root: MessageListItem | null
    ) => {
      const found = resolveMark(mark, blocks);
      if (!found) return;
      const placed: CommentMark = {
        block: found.block,
        start: found.start,
        length: found.length,
        text: found.text,
      };
      if (found.relocated && root) relocations.push([markId, placed]);
      out.push({
        id,
        markId,
        root,
        resolved: !!root?.state.resolved,
        mark: placed,
      });
    };
    for (const root of options.roots()) {
      if (!live(root)) continue;
      const markId = threadMarkId(root);
      if (!markId) continue;
      // A thread posted with only its quoted text (an agent's comment, or one
      // whose mark was never written) is placed by finding that text; an
      // editor then pins it with a real mark.
      const mark = all.get(markId) ?? quotedMark(root);
      if (mark) place(root.id, markId, mark, root);
    }
    const pending = draft();
    if (pending) place(pending.markId, pending.markId, pending.mark, null);
    return { threads: out, relocations };
  });

  // Highlight geometry comes from the engine (asynchronously).
  let generation = 0;
  createEffect(
    on([placement, options.geometry.revision], ([{ threads }]) => {
      const current = ++generation;
      Promise.all(
        threads.map(async (thread) => ({
          ...thread,
          rects: await options.geometry.rangeRects(
            { block: thread.mark.block, offset: thread.mark.start },
            {
              block: thread.mark.block,
              offset: thread.mark.start + thread.mark.length,
            }
          ),
        }))
      )
        .then((next) => {
          if (current === generation) setLocated(next);
        })
        .catch(() => {});
    })
  );

  // Keep stored offsets close to the text so later edits relocate cheaply.
  // Writing a relocated mark re-resolves it in place, so this settles; marks
  // already stored at the new place (another editor got there first) are
  // left alone so peers do not commit the same move twice.
  createEffect(() => {
    const { relocations } = placement();
    const doc = options.doc;
    if (!relocations.length || !doc || !untrack(options.canEdit)) return;
    const stored = untrack(marks);
    for (const [markId, mark] of relocations) {
      const current = stored.get(markId);
      if (
        current &&
        current.block === mark.block &&
        current.start === mark.start &&
        current.length === mark.length &&
        current.text === mark.text
      )
        continue;
      writeCommentMark(doc, markId, mark);
    }
  });

  /** Threads that cannot be shown beside the text: legacy anchors or removed text. */
  const detached = createMemo(() => {
    // Until the text is known every thread would look detached.
    if (!paragraphs().length) return [];
    const shown = new Set(placement().threads.map((thread) => thread.id));
    return options
      .roots()
      .filter((root) => live(root) && root.state.anchor && !shown.has(root.id));
  });

  /** Start a comment on the current selection. False when nothing usable is selected. */
  function beginDraft(): boolean {
    const selection = options.geometry.selection();
    if (!selection) return false;
    const { from, to } = selection;
    if (from.block === to.block && from.offset === to.offset) return false;
    const paragraph = paragraphs().find((p) => p.id === from.block);
    if (!paragraph) return false;
    // A selection over several paragraphs anchors on the first one's part.
    const end = to.block === from.block ? to.offset : paragraph.text.length;
    const length = Math.min(end - from.offset, MAX_MARK_TEXT);
    const text = paragraph.text.slice(from.offset, from.offset + length);
    if (!text.trim()) return false;
    const markId = uuidv7();
    setDraft({
      markId,
      mark: { block: from.block, start: from.offset, length, text },
    });
    setActive(markId);
    return true;
  }

  function cancelDraft() {
    const pending = draft();
    setDraft(undefined);
    if (pending && active() === pending.markId) setActive(null);
  }

  /**
   * Persist the draft's mark, then post its thread. The mark is written
   * first so the new thread is placed the moment it appears; it is removed
   * again if posting fails.
   */
  async function commitDraft<T>(post: (draft: DocxCommentDraft) => Promise<T>) {
    const pending = draft();
    if (!pending || !options.doc) throw new Error('No comment to post');
    writeCommentMark(options.doc, pending.markId, pending.mark);
    try {
      const result = await post(pending);
      setDraft(undefined);
      return result;
    } catch (error) {
      deleteCommentMark(options.doc, pending.markId);
      throw error;
    }
  }

  /** The thread whose text contains a position. */
  function threadAt(pos: Pos): string | null {
    for (const thread of located()) {
      if (thread.resolved && active() !== thread.id) continue;
      const { block, start, length } = thread.mark;
      if (
        block === pos.block &&
        pos.offset >= start &&
        pos.offset <= start + length
      )
        return thread.id;
    }
    return null;
  }

  return {
    marks,
    located,
    detached,
    draft,
    active,
    setActive,
    beginDraft,
    cancelDraft,
    commitDraft,
    threadAt,
  };
}

export type DocxComments = ReturnType<typeof createDocxComments>;
