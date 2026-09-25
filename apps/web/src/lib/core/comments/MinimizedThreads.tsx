import { Popover } from '@kobalte/core/popover';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import { cn, Layer } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import { createEffect, createSignal, on, Show, useContext } from 'solid-js';
import type { Layout, Root } from './commentType';
import { MeasureContainer } from './MeasureContainer';
import { CommentsContext, ThreadCard } from './Thread';

export function MinimizedThread(props: {
  comment: Root;
  layout: Layout;
  isActive: boolean;
  theme?: EditorThemeClasses;
  maxHeight?: number;
  /**
   * When false, tapping only activates the thread instead of expanding the
   * floating card in place — for hosts that present the active thread
   * elsewhere (the touch comment drawer).
   */
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = createSignal<boolean>(false);
  const [badge, setBadge] = createSignal<HTMLDivElement>();

  const expandable = () => props.expandable !== false;

  if (props.comment.isNew && expandable()) {
    setExpanded(true);
  }

  const { highlightedCommentId, setActiveThread } = useContext(CommentsContext);
  // Resolving from the expanded card folds the thread back to its badge.
  createEffect(
    on(
      () => props.comment.resolved,
      (resolved) => {
        if (resolved) setExpanded(false);
      },
      { defer: true }
    )
  );
  createEffect(() => {
    if (!expandable()) return;
    const hId = highlightedCommentId();
    if (hId === null) return;
    if (hId === props.comment.id || props.comment.children.includes(hId)) {
      setExpanded(true);
    }
  });

  // TODO (seamus) : in the current version of minimized threads the ids are
  // not being shown.
  // const _userIds = createMemo(() => {
  //   const ids = new Set<string>();
  //   ids.add(props.comment.author);
  //   for (const replyId of props.comment.children) {
  //     const reply = getCommentById(replyId) as Reply | undefined;
  //     if (reply && reply.author) ids.add(reply.author);
  //   }
  //   return Array.from(ids);
  // });

  const commentCount = () =>
    1 + (props.comment.replyCount ?? props.comment.children.length);
  const clickHandler = () => {
    if (expandable()) {
      setExpanded(true);
    } else {
      setActiveThread(props.comment.threadId);
    }
  };

  return (
    <>
      <MeasureContainer
        alignment={'left'}
        alignmentOffset={0}
        top={props.layout.calculatedYPos}
        threadId={props.comment.threadId}
        maxHeight={props.maxHeight}
        isActive={props.isActive}
        transition={false}
      >
        <Layer depth={2}>
          <div
            ref={setBadge}
            class={cn(
              'transition-transform flex items-center group text-ink-extra-muted pointer-events-auto',
              props.isActive && '-translate-x-4'
            )}
            onClick={clickHandler}
          >
            <div
              class={cn('inline-flex items-center gap-1 px-1 rounded-lg', {
                'group-hover:bg-hover': !props.isActive,
                'bg-comment/10 group-hover:bg-comment/20': props.isActive,
              })}
            >
              <Show
                when={props.comment.resolved}
                fallback={
                  <ChatTeardrop class="size-4" onClick={clickHandler} />
                }
              >
                <CheckCircle
                  class="size-4 text-success"
                  onClick={clickHandler}
                />
              </Show>
              <div class="flex items-center px-1 h-6">
                <span class="text-xs text-center">{commentCount()}</span>
              </div>
            </div>
          </div>
        </Layer>
      </MeasureContainer>
      {/* A dismissable layer, not an outside-click listener: the delete
          confirmation and menus the card opens nest inside it, so pressing
          them does not dismiss the card. Unportaled, the card keeps the
          document's scroll and clipping like the badge it opens from. */}
      <Popover
        open={expanded()}
        onOpenChange={(open) => {
          setExpanded(open);
          // Discard a dismissed draft in the same tick; waiting for the
          // editor's selection change paints its badge and highlight a frame.
          // A thread activated by the same press keeps its selection.
          if (!open && props.comment.isNew && props.isActive)
            setActiveThread(null);
        }}
        anchorRef={badge}
        placement="left-start"
        gutter={4}
        flip
        slide
      >
        <Popover.Content
          class="outline-none"
          style={{ 'z-index': 'calc(var(--z-index-placeable) + 1)' }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // The badge reopens the card on click; closing on its press first
            // would make it flicker shut and open again.
            const target = e.detail.originalEvent.target;
            if (target instanceof Node && badge()?.contains(target))
              e.preventDefault();
          }}
          onClick={(e) => {
            setActiveThread(props.comment.threadId);
            e.stopPropagation();
          }}
        >
          <ThreadCard comment={props.comment} isActive width={320} />
        </Popover.Content>
      </Popover>
    </>
  );
}
