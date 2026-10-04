import { DOCX_LORO_CONTAINERS } from '@macro-inc/collaboration/docx/schema';
import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
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
import {
  blockSpanOfRange,
  contentRange,
  contentText,
} from '../core/text-offsets';

export type DocxCommentDraft = { markId: string; mark: CommentMark };

export type LocatedThread = {
  /** Thread root id, or the draft's mark id. */
  id: string;
  markId: string;
  root: MessageListItem | null;
  resolved: boolean;
  block: HTMLElement;
  range: Range;
};

type Paragraph = { id: string; text: string; element: HTMLElement };

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

/**
 * Comment anchoring for a rendered DOCX: marks live in the collaborative
 * document, threads come from the shared message store, and both are joined
 * to the paragraphs currently on screen.
 */
export function createDocxComments(options: {
  doc: LoroDoc | null;
  roots: Accessor<MessageListItem[]>;
  /** The element the editor renders the document body into. */
  root: Accessor<HTMLElement | undefined>;
  /** Bumps whenever the rendered document may have changed. */
  revision: Accessor<number>;
  canEdit: Accessor<boolean>;
}) {
  const [marks, setMarks] = createSignal<Map<string, CommentMark>>(
    options.doc ? readCommentMarks(options.doc) : new Map()
  );
  const [draft, setDraft] = createSignal<DocxCommentDraft>();
  const [active, setActive] = createSignal<string | null>(null);

  if (options.doc) {
    const doc = options.doc;
    const unsubscribe = doc
      .getMap(DOCX_LORO_CONTAINERS.marks)
      .subscribe(() => setMarks(readCommentMarks(doc)));
    onCleanup(unsubscribe);
  }

  const paragraphs = createMemo<Paragraph[]>(() => {
    options.revision();
    const root = options.root();
    if (!root) return [];
    const body = root.querySelector<HTMLElement>('.docx-body-flow') ?? root;
    return Array.from(body.querySelectorAll<HTMLElement>('[data-anchor]'))
      .filter((element) => !element.querySelector('[data-anchor]'))
      .map((element) => ({
        id: element.getAttribute('data-anchor')!,
        text: contentText(element),
        element,
      }));
  });

  const live = (root: MessageListItem) => !root.state.deleted_at;

  const placement = createMemo(() => {
    const blocks = paragraphs();
    const all = marks();
    const out: LocatedThread[] = [];
    const relocations: Array<[string, CommentMark]> = [];
    const place = (
      id: string,
      markId: string,
      mark: CommentMark,
      root: MessageListItem | null
    ) => {
      const found = resolveMark(mark, blocks);
      if (!found) return false;
      const block = blocks.find((paragraph) => paragraph.id === found.block);
      const range =
        block && contentRange(block.element, found.start, found.length);
      if (!block || !range) return false;
      if (found.relocated && root)
        relocations.push([
          markId,
          {
            block: found.block,
            start: found.start,
            length: found.length,
            text: found.text,
          },
        ]);
      out.push({
        id,
        markId,
        root,
        resolved: !!root?.state.resolved,
        block: block.element,
        range,
      });
      return true;
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
  const located = () => placement().threads;

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
    const shown = new Set(located().map((thread) => thread.id));
    return options
      .roots()
      .filter((root) => live(root) && root.state.anchor && !shown.has(root.id));
  });

  /** Start a comment on the current selection. False when nothing usable is selected. */
  function beginDraft(): boolean {
    const root = options.root();
    const selection = window.getSelection();
    if (
      !root ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    )
      return false;
    const span = blockSpanOfRange(selection.getRangeAt(0), root);
    if (!span) return false;
    const id = span.block.getAttribute('data-anchor');
    const length = Math.min(span.length, MAX_MARK_TEXT);
    const text = contentText(span.block).slice(span.start, span.start + length);
    if (!id || !text.trim()) return false;
    const markId = uuidv7();
    setDraft({ markId, mark: { block: id, start: span.start, length, text } });
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

  /** The thread whose highlight contains a caret position. */
  function threadAt(node: Node, offset: number): string | null {
    for (const thread of located()) {
      if (thread.resolved && active() !== thread.id) continue;
      if (
        thread.range.comparePoint(node, offset) === 0 &&
        thread.block.contains(node)
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
