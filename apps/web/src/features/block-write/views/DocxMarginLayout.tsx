import ChatCircleText from '@phosphor/chat-circle-text.svg';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { layoutMarginCards } from '../core/comment-layout';
import { blockOf } from '../core/text-offsets';
import type {
  DocxComments,
  LocatedThread,
} from '../primitives/create-docx-comments';

const CARD_WIDTH = 280;

/**
 * The comment margin beside a DOCX: one card per placed thread, stacked next
 * to its text, a floating comment button beside any selection, and clicks on
 * highlighted text open their thread. The card itself is supplied.
 */
export function DocxMarginLayout(props: {
  comments: DocxComments;
  /** The editor element; selection and clicks are read from it. */
  editorRoot: HTMLElement | undefined;
  /** Positioning parent: the margin scrolls with the document. */
  margin: HTMLElement | undefined;
  revision: Accessor<number>;
  canComment: Accessor<boolean>;
  renderCard: (
    thread: LocatedThread,
    isActive: Accessor<boolean>
  ) => JSX.Element;
}) {
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [layoutTick, setLayoutTick] = createSignal(0);
  const relayout = () => setLayoutTick((tick) => tick + 1);

  createEffect(() => {
    const margin = props.margin;
    const root = props.editorRoot;
    if (!margin || !root) return;
    const observer = new ResizeObserver(relayout);
    observer.observe(margin);
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const anchorTop = (thread: LocatedThread, marginTop: number) => {
    const rects = thread.range.getClientRects();
    const first = rects.length
      ? rects[0]
      : thread.range.getBoundingClientRect();
    return first.top - marginTop;
  };

  const positions = createMemo(() => {
    layoutTick();
    props.revision();
    const margin = props.margin;
    if (!margin) return new Map<string, number>();
    const marginTop = margin.getBoundingClientRect().top;
    const items = props.comments
      .located()
      .map((thread) => ({ id: thread.id, top: anchorTop(thread, marginTop) }));
    return layoutMarginCards(
      items,
      new Map(Object.entries(heights)),
      props.comments.active()
    );
  });

  // Clicking highlighted text opens its thread.
  createEffect(() => {
    const root = props.editorRoot;
    if (!root) return;
    const onClick = () => {
      const selection = window.getSelection();
      if (!selection?.isCollapsed || !selection.anchorNode) return;
      if (!blockOf(selection.anchorNode, root)) return;
      const hit = props.comments.threadAt(
        selection.anchorNode,
        selection.anchorOffset
      );
      if (hit) props.comments.setActive(hit);
      else if (!props.comments.draft()) props.comments.setActive(null);
    };
    root.addEventListener('click', onClick);
    onCleanup(() => root.removeEventListener('click', onClick));
  });

  // A floating "comment" affordance beside any selected text.
  const [selectionTop, setSelectionTop] = createSignal<number | null>(null);
  createEffect(() => {
    const root = props.editorRoot;
    const margin = props.margin;
    if (!root || !margin) return;
    const update = () => {
      const selection = window.getSelection();
      if (
        !props.canComment() ||
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !blockOf(selection.getRangeAt(0).startContainer, root)
      ) {
        setSelectionTop(null);
        return;
      }
      const rect = selection.getRangeAt(0).getClientRects()[0];
      setSelectionTop(
        rect ? rect.top - margin.getBoundingClientRect().top : null
      );
    };
    document.addEventListener('selectionchange', update);
    onCleanup(() => document.removeEventListener('selectionchange', update));
  });

  return (
    <>
      <Show when={selectionTop() !== null && !props.comments.draft()}>
        <div
          class="absolute left-2 z-10"
          style={{ top: `${selectionTop()}px` }}
        >
          <Button
            size="icon-md"
            variant="cta"
            label="Comment"
            data-docx-comment-button
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
              {props.renderCard(thread, isActive)}
            </div>
          );
        }}
      </For>
    </>
  );
}
