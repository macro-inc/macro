import {
  activeCommentThreadSignal,
  highlightedCommentThreadsSignal,
  markStore,
  threadStore,
} from '@block-md/comments/commentStore';
import { mdStore } from '@block-md/signal/markdownBlockData';
import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@components/app/mobile/MobileDrawer';
import { getAndClearCommentMentions } from '@core/comments';
import type { CommentOperations, Root } from '@core/comments/commentType';
import { NewReplyInput } from '@core/comments/Inputs';
import {
  CommentsContext,
  ThreadBody,
  ThreadContext,
} from '@core/comments/Thread';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button } from '@ui';
import { $setSelection } from 'lexical';
import { createMemo, createSignal, Show, useContext } from 'solid-js';

/**
 * `baseCommentTheme` minus its `select-text` on message text. The drawer is
 * `select-none` — a press-and-hold on message text would otherwise start the
 * iOS selection gesture (magnifier loupe), and corvu aborts drag-to-dismiss
 * while any DOM selection exists — but an explicit select-text on the text
 * spans would win over the parent's select-none, so the theme must not
 * stamp it. Typing areas opt back in via the drawer's contenteditable rule.
 */
const drawerCommentTheme = createTheme({ root: 'text-sm' });

/**
 * Focus target for the drawer's opening focus pass: the draft composer's
 * editable, when one is mounted. An existing thread renders only the
 * "Reply…" placeholder (no editable), so viewing a thread doesn't raise the
 * keyboard while composing a new comment does.
 */
function getCommentComposerInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-comment-thread-drawer] [contenteditable="true"]'
  );
}

/**
 * The drawer's always-visible reply composer, pinned below the scrolling
 * thread. Extracted so its state (text, mentions) resets when the pager
 * switches threads (the host keys it by thread). Provides its own
 * ThreadContext so @-mentions typed here are captured.
 */
function PinnedReplyComposer(props: {
  root: Root;
  createComment: CommentOperations['createComment'];
}) {
  const mentionsSignal = createSignal<UserMentionRecord[]>([]);
  const [text, setText] = createSignal('');
  const [editing, setEditing] = createSignal(false);

  return (
    <ThreadContext.Provider value={{ mentionsSignal }}>
      <StaticMarkdownContext theme={drawerCommentTheme}>
        <div
          class="shrink-0 px-3"
          classList={{ 'pb-(--safe-bottom)': !virtualKeyboardVisible() }}
        >
          <NewReplyInput
            textValue={text()}
            setTextValue={setText}
            isEditing={editing()}
            setEditing={setEditing}
            deactivateThreadOnCancel={false}
            createReply={(content) => {
              if (content.trim() === '') return;
              setEditing(false);
              return props.createComment({
                threadId: props.root.threadId,
                text: content,
                mentions: getAndClearCommentMentions(mentionsSignal),
              });
            }}
          />
        </div>
      </StaticMarkdownContext>
    </ThreadContext.Provider>
  );
}

/**
 * Bottom-sheet presentation of the active comment thread for touch devices,
 * replacing the floating margin cards used with a pointer. Opens on explicit
 * activation only — the selection toolbar's "Show comment", a minimized rail
 * icon, creating a draft comment, or URL navigation; placing the caret in a
 * commented range merely highlights it. When the document holds several
 * threads, a pager bar steps between them in document order. Dismissing the
 * drawer deactivates the thread, which also discards an unsent draft.
 *
 * Must be mounted inside the `CommentsContext` provider (see CommentMargin).
 */
export function CommentThreadDrawer() {
  const threads = threadStore.get;
  const [marks] = markStore;
  const md = mdStore.get;

  const activeCommentThread = activeCommentThreadSignal.get;
  const setActiveCommentThread = activeCommentThreadSignal.set;
  const setHighlightedCommentThreads = highlightedCommentThreadsSignal.set;

  const parentCommentsContext = useContext(CommentsContext);
  // Messages report their inline-edit state; while any edit input is open,
  // the pinned reply composer hides so two inputs never compete.
  const [editingMessageIds, setEditingMessageIds] = createSignal<
    ReadonlySet<number>
  >(new Set());
  const messageEditing = () => editingMessageIds().size > 0;
  const drawerCommentsContext = {
    ...parentCommentsContext,
    setMessageEditing: (commentId: number, editing: boolean) =>
      setEditingMessageIds((prev) => {
        if (prev.has(commentId) === editing) return prev;
        const next = new Set(prev);
        if (editing) next.add(commentId);
        else next.delete(commentId);
        return next;
      }),
  };

  const activeRoot = createMemo<Root | undefined>(() => {
    const active = activeCommentThread();
    return active == null ? undefined : threads[active];
  });

  const firstMarkElement = (root: Root) =>
    Object.values(marks[root.anchorId]?.markNodes ?? {})[0];

  // Server threads in document order, from their marks' positions (viewport
  // rects preserve relative document order; this works with the margin
  // hidden, since marks live in the editor itself).
  const orderedThreadIds = createMemo(() => {
    return Object.values(threads)
      .filter((root): root is Root => !!root && root.threadId !== -1)
      .map((root) => {
        const rect = firstMarkElement(root)?.getBoundingClientRect();
        return {
          threadId: root.threadId,
          top: rect?.top ?? Number.MAX_SAFE_INTEGER,
          left: rect?.left ?? 0,
        };
      })
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((entry) => entry.threadId);
  });

  const pagerIndex = createMemo(() => {
    const active = activeCommentThread();
    return active == null ? -1 : orderedThreadIds().indexOf(active);
  });

  // The pager applies to saved threads only — a draft (-1) is mid-compose.
  const showPager = () => pagerIndex() >= 0 && orderedThreadIds().length > 1;

  const goToThread = (direction: 1 | -1) => {
    const ids = orderedThreadIds();
    const target = ids[pagerIndex() + direction];
    if (target == null) return;
    // Leaving the caret in the previous thread's mark would let the
    // selection-sync effect null the newly activated thread on the next
    // editor update (see CommentsProvider) — and the old selection has
    // served its purpose anyway.
    md.editor?.update(() => $setSelection(null));
    setActiveCommentThread(target);
    setHighlightedCommentThreads([target]);
    const root = threads[target];
    if (root) {
      firstMarkElement(root)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    // The dismissing tap lands on the drawer overlay, so the editor's
    // selection still sits inside the comment mark. Clear it so tapping the
    // highlight again registers as a selection change and reopens the drawer.
    md.editor?.update(() => $setSelection(null));
    setActiveCommentThread(null);
    setHighlightedCommentThreads([]);
  };

  return (
    <MobileDrawer
      side="bottom"
      // Opens only on explicit activation (the toolbar's "Show comment", a
      // rail icon, a new draft, or URL navigation) — merely placing the
      // caret inside a commented range only highlights the thread, and the
      // selection toolbar offers to open it instead.
      open={activeRoot() != null}
      onOpenChange={handleOpenChange}
      closeOnOutsidePointerStrategy="pointerdown"
      preventScroll={false}
      preventScrollbarShift={false}
      initialFocusEl={getCommentComposerInput() ?? undefined}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label="Comments"
          // Viewing a thread opens at a fixed half-screen height — short
          // threads leave space, long ones scroll inside. A new-comment
          // draft is just the composer, so it fits its content instead.
          targetHeight={activeRoot()?.isNew ? undefined : 50}
          // select-none: a press-and-hold on message text would start an
          // iOS text-selection gesture (magnifier loupe), which claims the
          // touch and cancels corvu's drag-to-dismiss (corvu aborts drags
          // while any DOM selection exists). Typing areas opt back in.
          class="select-none [&_[contenteditable=true]]:select-text"
          data-comment-thread-drawer
        >
          <MobileDrawer.Handle class="pb-1" />
          <Show when={showPager()}>
            <div class="flex shrink-0 items-center justify-center gap-2 pb-1">
              <Button
                size="icon-sm"
                class="rounded-md"
                depth={3}
                variant="ghost"
                aria-label="Previous comment thread"
                disabled={pagerIndex() <= 0}
                onClick={() => goToThread(-1)}
              >
                <CaretLeftIcon class="size-4" />
              </Button>
              <span class="text-xs text-ink-muted">
                {pagerIndex() + 1} of {orderedThreadIds().length}
              </span>
              <Button
                size="icon-sm"
                class="rounded-md"
                depth={3}
                variant="ghost"
                aria-label="Next comment thread"
                disabled={pagerIndex() >= orderedThreadIds().length - 1}
                onClick={() => goToThread(1)}
              >
                <CaretRightIcon class="size-4" />
              </Button>
            </div>
          </Show>
          <MobileDrawer.ScrollBody
            class="px-3"
            // The ScrollBody is the drawer's scroll container, so the
            // built-in Content-level handler can't scroll it — bring a
            // focused composer into view above the rising keyboard here
            // (same pattern as the mobile email composer).
            onFocusIn={(e: FocusEvent) => scrollToFocusedInput(e)}
          >
            <CommentsContext.Provider value={drawerCommentsContext}>
              <Show when={activeRoot()} keyed>
                {(root) => (
                  <div class="shrink-0">
                    <ThreadBody
                      comment={root}
                      isActive
                      theme={drawerCommentTheme}
                      hideReplyInput
                      actionsDropdown
                    />
                  </div>
                )}
              </Show>
            </CommentsContext.Provider>
          </MobileDrawer.ScrollBody>
          <Show
            when={
              !activeRoot()?.isNew &&
              parentCommentsContext.canComment() &&
              activeRoot()
            }
            keyed
          >
            {(root) => (
              // Hidden, not unmounted, while a message edit is open — an
              // in-progress reply draft survives the edit.
              <div classList={{ hidden: messageEditing() }}>
                <PinnedReplyComposer
                  root={root}
                  createComment={
                    parentCommentsContext.commentOperations.createComment
                  }
                />
              </div>
            )}
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
