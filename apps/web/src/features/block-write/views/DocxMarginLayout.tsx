import ChatCircleText from '@phosphor/chat-circle-text.svg';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { layoutMarginCards } from '../core/comment-layout';
import type {
  DocxComments,
  LocatedThread,
} from '../primitives/create-docx-comments';
import { type PageGeometry, toColumn } from './DocxPages';
import { DocxWordCommentCard } from './DocxWordComment';

const CARD_WIDTH = 280;

/**
 * The comment margin beside a DOCX: one card per placed thread, stacked next
 * to its text, and a floating comment button beside any selection. The card
 * itself is supplied. The margin shares its top edge with the pages column,
 * so anchors are page geometry in column coordinates.
 */
export function DocxMarginLayout(props: {
  comments: DocxComments;
  geometry: Accessor<PageGeometry>;
  /** Top of the selected text, when there is a selection to comment on. */
  selectionTop: Accessor<number | null>;
  canComment: Accessor<boolean>;
  /** The card of a Macro thread (the document's own comments have theirs). */
  renderCard: (
    thread: LocatedThread,
    isActive: Accessor<boolean>
  ) => JSX.Element;
}) {
  const [heights, setHeights] = createStore<Record<string, number>>({});

  const anchorTop = (thread: LocatedThread) => {
    const first = thread.rects[0];
    const box = first ? toColumn(props.geometry(), first) : undefined;
    return box?.top ?? 0;
  };

  const positions = createMemo(() => {
    const items = props.comments
      .located()
      .map((thread) => ({ id: thread.id, top: anchorTop(thread) }));
    return layoutMarginCards(
      items,
      new Map(Object.entries(heights)),
      props.comments.active()
    );
  });

  return (
    <>
      <Show
        when={
          props.canComment() &&
          props.selectionTop() !== null &&
          !props.comments.draft()
        }
      >
        <div
          class="absolute left-2 z-10"
          style={{ top: `${props.selectionTop()}px` }}
        >
          <Button
            size="icon-md"
            variant="cta"
            label="Comment"
            data-docx-comment-button
            onPointerDown={(event: PointerEvent) => event.preventDefault()}
            onMouseDown={(event: MouseEvent) => event.preventDefault()}
            onClick={() => props.comments.beginDraft()}
          >
            <ChatCircleText />
          </Button>
        </div>
      </Show>
      <For each={props.comments.located()}>
        {(thread) => {
          let card!: HTMLDivElement;
          createEffect(() => {
            const observer = new ResizeObserver(() =>
              setHeights(thread.id, card.offsetHeight)
            );
            observer.observe(card);
            onCleanup(() => observer.disconnect());
          });
          const top = () => positions().get(thread.id) ?? 0;
          const isActive = () => props.comments.active() === thread.id;
          return (
            <div
              ref={card}
              data-docx-thread={thread.id}
              class="absolute left-2 transition-[top] duration-150"
              classList={{
                'z-20': isActive(),
                'opacity-70': thread.resolved && !isActive(),
              }}
              style={{ top: `${top()}px`, width: `${CARD_WIDTH}px` }}
              onClick={() => props.comments.setActive(thread.id)}
            >
              <Show
                when={thread.word}
                fallback={props.renderCard(thread, isActive)}
              >
                {(word) => (
                  <DocxWordCommentCard
                    comment={word().comment}
                    replies={word().replies}
                  />
                )}
              </Show>
            </div>
          );
        }}
      </For>
    </>
  );
}
