/**
 * Review ▸ Comments: the Comments pane's state (open, the thread picked, a
 * new comment being written), comment markers, and the comment commands,
 * which go through the session as edit operations.
 */

import type {
  CommentOutline,
  EditOp,
  ShapeOutline,
} from '@core/pptx-engine/types';
import { type Accessor, batch, createSignal } from 'solid-js';
import type { CommentAuthor } from '../context/pptx-editor-context';
import type { Point } from '../core/geometry';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

/** A comment being written, before it is posted. */
export interface CommentDraft {
  slide: number;
  /** The shape it will be attached to; else the slide's top-left corner. */
  shape?: number;
}

export interface CommentsOptions {
  session: PresentationSession;
  editor: SlideEditor;
  canEdit: Accessor<boolean>;
  author: Accessor<CommentAuthor>;
  /** Called when the Comments pane opens (other panes make way). */
  onShowPane?: () => void;
}

/** Where a thread's marker sits (slide points), PowerPoint-style. */
export function markerPoint(
  thread: Pick<CommentOutline, 'shape' | 'x' | 'y'>,
  findShape: (id: number) => ShapeOutline | undefined
): Point {
  const shape =
    thread.shape === undefined ? undefined : findShape(thread.shape);
  if (shape) return { x: shape.x + shape.w, y: shape.y };
  if (thread.x !== undefined || thread.y !== undefined)
    return { x: thread.x ?? 0, y: thread.y ?? 0 };
  return { x: 0, y: 0 };
}

/** Every thread of the deck in order: slide by slide, as added. */
function allThreads(session: PresentationSession) {
  return (session.outline()?.slides ?? []).flatMap((slide) =>
    (slide.comments ?? []).map((thread) => ({ slide, thread }))
  );
}

export function createComments(options: CommentsOptions) {
  const { session, editor } = options;
  const [paneOpen, setPaneOpenRaw] = createSignal(false);
  const setPaneOpen = (open: boolean) => {
    if (open && !paneOpen()) options.onShowPane?.();
    setPaneOpenRaw(open);
  };
  /** Show Markup: comment markers on the slide. */
  const [markup, setMarkup] = createSignal(true);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<CommentDraft | null>(null);

  const threads = (): CommentOutline[] =>
    session.currentSlide()?.comments ?? [];
  const current = () => threads().find((t) => t.id === selected());
  const author = () => {
    const a = options.author();
    return { name: a.name.trim() || 'Author', initials: a.initials };
  };

  const apply = async (ops: EditOp[]) => {
    if (!options.canEdit()) return null;
    return session.apply(ops);
  };

  /** Opens the pane on a thread (and its slide). */
  function select(id: string | null) {
    batch(() => {
      setSelected(id);
      if (id !== null) setPaneOpen(true);
    });
  }

  /**
   * Starts a new comment (Review ▸ New Comment, Ctrl+Alt+M): on the
   * selected shape, else on the slide, written in the pane.
   */
  function newComment() {
    const slide = session.currentSlide();
    if (!slide || !options.canEdit()) return;
    // On the selected shape (the edited one while typing), else the slide.
    const shape = editor.editing()?.shape ?? editor.selection()[0]?.id;
    batch(() => {
      setDraft({ slide: slide.id, shape });
      setSelected(null);
      setPaneOpen(true);
    });
  }

  async function post(text: string) {
    const d = draft();
    if (!d || !text.trim()) return;
    const before = new Set(threads().map((t) => t.id));
    const who = author();
    const result = await apply([
      {
        op: 'addComment',
        slide: d.slide,
        text,
        author: who.name,
        ...(who.initials ? { initials: who.initials } : {}),
        ...(d.shape !== undefined ? { shape: d.shape } : {}),
      },
    ]);
    if (!result) return;
    const added = threads().find((t) => !before.has(t.id));
    batch(() => {
      setDraft(null);
      setSelected(added?.id ?? null);
    });
  }

  const slideOf = (thread: string) =>
    session
      .outline()
      ?.slides.find((s) =>
        (s.comments ?? []).some(
          (t) =>
            t.id === thread || (t.replies ?? []).some((r) => r.id === thread)
        )
      )?.id;

  async function reply(thread: string, text: string) {
    const slide = slideOf(thread);
    if (slide === undefined || !text.trim()) return;
    const who = author();
    await apply([
      {
        op: 'replyComment',
        slide,
        comment: thread,
        text,
        author: who.name,
        ...(who.initials ? { initials: who.initials } : {}),
      },
    ]);
  }

  async function edit(id: string, text: string) {
    const slide = slideOf(id);
    if (slide === undefined || !text.trim()) return;
    await apply([{ op: 'editComment', slide, comment: id, text }]);
  }

  async function resolve(thread: string, resolved: boolean) {
    const slide = slideOf(thread);
    if (slide === undefined) return;
    await apply([{ op: 'resolveComment', slide, comment: thread, resolved }]);
  }

  /** Deletes a thread or a reply. */
  async function remove(id: string) {
    const slide = slideOf(id);
    if (slide === undefined) return;
    const result = await apply([{ op: 'deleteComment', slide, comment: id }]);
    if (result && selected() === id) setSelected(null);
  }

  /** Review ▸ Delete: the thread picked in the pane, else the slide's first. */
  async function deleteCurrent() {
    const target = current() ?? threads()[0];
    if (target) await remove(target.id);
  }

  async function deleteAll(scope: 'slide' | 'presentation') {
    const slide = session.currentSlide();
    if (!slide) return;
    const result = await apply([
      scope === 'slide'
        ? { op: 'deleteAllComments', slide: slide.id }
        : { op: 'deleteAllComments' },
    ]);
    if (result) setSelected(null);
  }

  /** Review ▸ Previous / Next: the thread before or after, across slides. */
  function step(direction: 1 | -1) {
    const all = allThreads(session);
    if (all.length === 0) return;
    const index = session.slideIndex();
    const at = all.findIndex((e) => e.thread.id === selected());
    let next: (typeof all)[number] | undefined;
    if (at >= 0) next = all[(at + direction + all.length) % all.length];
    else if (direction > 0)
      next = all.find((e) => e.slide.index >= index) ?? all[0];
    else
      next =
        [...all].reverse().find((e) => e.slide.index <= index) ??
        all[all.length - 1];
    if (!next) return;
    editor.goToSlide(next.slide.index);
    select(next.thread.id);
  }

  return {
    paneOpen,
    setPaneOpen,
    togglePane: () => setPaneOpen(!paneOpen()),
    markup,
    setMarkup,
    selected,
    select,
    draft,
    cancelDraft: () => setDraft(null),
    threads,
    count: () => allThreads(session).length,
    author,
    newComment,
    post,
    reply,
    edit,
    resolve,
    remove,
    deleteCurrent,
    deleteAll,
    previous: () => step(-1),
    next: () => step(1),
  };
}

export type CommentsState = ReturnType<typeof createComments>;
