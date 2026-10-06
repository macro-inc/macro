/**
 * Comments on the canvas while the comment tool is on: a pin per thread at
 * a constant size wherever the view is zoomed (filled when unread), the
 * open thread beside its pin, and a click anywhere placing a new comment.
 * The thread and the composer inside the cards are the comment store's.
 */

import CheckCircle from '@phosphor/check-circle.svg';
import X from '@phosphor/x.svg';
import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type Camera, pageToScreen, screenToPage } from '../core/camera';
import { initialsOf } from '../core/comments';
import type { FigComments } from '../primitives/create-fig-comments';

/** Width of the card beside a pin, CSS px. */
const CARD = 320;

function Pin(props: {
  label: string;
  unread?: boolean;
  resolved?: boolean;
  open?: boolean;
  testId: string;
  thread?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class="-translate-y-full absolute flex size-7 items-center justify-center rounded-full rounded-bl-none border-2 font-semibold text-[10px] shadow-md"
      classList={{
        'border-accent bg-accent text-accent-contrast':
          props.unread || props.open,
        'border-surface bg-panel text-ink': !props.unread && !props.open,
        'opacity-60': props.resolved,
      }}
      data-testid={props.testId}
      data-thread={props.thread}
      data-unread={props.unread ? 'true' : 'false'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.();
      }}
    >
      {props.label}
    </button>
  );
}

/**
 * A card beside a pin. Its pointer and wheel stay off the canvas (it
 * scrolls instead of panning); Escape closes it once whatever has focus
 * inside (a mention menu, an edit) has had it.
 */
function PinCard(props: {
  /** The pin, in screen px. */
  at: { x: number; y: number };
  viewport: { w: number; h: number };
  testId: string;
  thread?: string;
  resolved?: boolean;
  onClose: () => void;
  children: JSX.Element;
}) {
  const top = () =>
    Math.max(8, Math.min(props.at.y - 28, props.viewport.h - 160));
  return (
    <div
      class="absolute z-10 flex flex-col overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink text-xs shadow-lg"
      style={{
        left: `${Math.max(8, Math.min(props.at.x + 16, props.viewport.w - CARD - 8))}px`,
        top: `${top()}px`,
        width: `${CARD}px`,
        'max-height': `${Math.max(120, props.viewport.h - top() - 8)}px`,
      }}
      data-testid={props.testId}
      data-thread={props.thread}
      data-resolved={
        props.resolved === undefined ? undefined : String(props.resolved)
      }
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        props.onClose();
      }}
    >
      {props.children}
    </div>
  );
}

export function CommentPins(props: {
  comments: FigComments;
  camera: Camera;
  viewport: { w: number; h: number };
  /** A card closed with Escape: keys go back to the canvas. */
  onDismiss: () => void;
}) {
  const c = props.comments;
  const store = c.store;
  const screen = (p: { x: number; y: number }) => pageToScreen(props.camera, p);
  const shownPins = () =>
    c
      .pins()
      .filter((p) =>
        c.filter() === 'all'
          ? true
          : c.filter() === 'resolved'
            ? p.thread.resolved
            : !p.thread.resolved || p.thread.id === c.openThread()
      );
  const open = () => c.pins().find((p) => p.thread.id === c.openThread());

  const local = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div class="absolute inset-0" data-testid="fig-comment-layer">
      {/* Catches clicks so they place comments instead of selecting. */}
      <div
        class="absolute inset-0"
        style={{ cursor: store.canComment() ? 'crosshair' : 'default' }}
        data-testid="fig-comment-canvas"
        onPointerDown={(e) => {
          if (e.button === 0) e.stopPropagation();
        }}
        onClick={(e) => {
          if (c.draft() || c.openThread()) {
            c.cancelDraft();
            c.setOpenThread(undefined);
            return;
          }
          void c.placeAt(screenToPage(props.camera, local(e)));
        }}
      />
      <For each={shownPins()}>
        {(pin) => {
          const at = () => screen(pin.at);
          return (
            <div
              class="pointer-events-none absolute top-0 left-0"
              style={{ transform: `translate(${at().x}px, ${at().y}px)` }}
            >
              <div class="pointer-events-auto">
                <Pin
                  label={initialsOf(pin.thread.comments[0]?.author.name ?? '?')}
                  unread={pin.unread}
                  resolved={pin.thread.resolved}
                  open={c.openThread() === pin.thread.id}
                  testId="fig-comment-pin"
                  thread={pin.thread.id}
                  onClick={() =>
                    c.setOpenThread(
                      c.openThread() === pin.thread.id
                        ? undefined
                        : pin.thread.id
                    )
                  }
                />
              </div>
            </div>
          );
        }}
      </For>
      <Show when={c.draft()}>
        {(d) => {
          const at = () => screen(d().at);
          const close = () => {
            c.cancelDraft();
            props.onDismiss();
          };
          return (
            <>
              <div
                class="pointer-events-none absolute top-0 left-0"
                style={{ transform: `translate(${at().x}px, ${at().y}px)` }}
              >
                <Pin label="+" open testId="fig-comment-draft-pin" />
              </div>
              <PinCard
                at={at()}
                viewport={props.viewport}
                testId="fig-comment-draft"
                onClose={close}
              >
                <div class="min-h-0 overflow-y-auto p-2">
                  <Dynamic
                    component={store.Composer}
                    anchor={d().anchor}
                    onPosted={c.posted}
                    onCancel={close}
                  />
                </div>
              </PinCard>
            </>
          );
        }}
      </Show>
      {/* Keyed by thread, so opening another starts its thread afresh. */}
      <Show when={open()?.thread.id} keyed>
        {(threadId) => {
          const thread = () => open()?.thread;
          const close = () => {
            c.setOpenThread(undefined);
            props.onDismiss();
          };
          return (
            <Show when={open()}>
              {(pin) => (
                <PinCard
                  at={screen(pin().at)}
                  viewport={props.viewport}
                  testId="fig-comment-popover"
                  thread={threadId}
                  resolved={thread()?.resolved ?? false}
                  onClose={close}
                >
                  <div class="flex h-9 shrink-0 items-center gap-1 border-edge-muted border-b pr-1 pl-3">
                    <span class="flex-1 text-[11px] text-ink-muted">
                      {thread()?.resolved ? 'Resolved' : 'Comment'}
                    </span>
                    <Show when={store.canComment()}>
                      <button
                        type="button"
                        class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
                        data-testid={
                          thread()?.resolved
                            ? 'fig-comment-reopen'
                            : 'fig-comment-resolve'
                        }
                        onClick={() =>
                          void store.setResolved(threadId, !thread()?.resolved)
                        }
                      >
                        <CheckCircle class="size-3.5" />
                        {thread()?.resolved ? 'Reopen' : 'Resolve'}
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                      aria-label="Close comment"
                      data-testid="fig-comment-close"
                      onClick={close}
                    >
                      <X class="size-3.5" />
                    </button>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto p-3">
                    <Dynamic component={store.Thread} threadId={threadId} />
                  </div>
                </PinCard>
              )}
            </Show>
          );
        }}
      </Show>
    </div>
  );
}
