/**
 * Comments on the canvas while the comment tool is on: a pin per thread at
 * a constant size wherever the view is zoomed (filled when unread), the
 * open thread beside its pin, and a click anywhere placing a new comment.
 */

import { For, Show } from 'solid-js';
import { type Camera, pageToScreen, screenToPage } from '../core/camera';
import { initialsOf } from '../core/comments';
import type { FigComments } from '../primitives/create-fig-comments';
import { CommentComposer } from './comment-composer';
import { CommentThreadView } from './comment-thread';

/** Width of the thread card beside a pin, CSS px. */
const CARD = 280;

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

export function CommentPins(props: {
  comments: FigComments;
  camera: Camera;
  viewport: { w: number; h: number };
}) {
  const c = props.comments;
  const store = c.store;
  const screen = (p: { x: number; y: number }) => pageToScreen(props.camera, p);
  /** Where a card beside screen point `p` fits in the view. */
  const cardAt = (p: { x: number; y: number }) => ({
    left: `${Math.max(8, Math.min(p.x + 16, props.viewport.w - CARD - 8))}px`,
    top: `${Math.max(8, Math.min(p.y - 28, props.viewport.h - 220))}px`,
  });
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
          return (
            <>
              <div
                class="pointer-events-none absolute top-0 left-0"
                style={{ transform: `translate(${at().x}px, ${at().y}px)` }}
              >
                <Pin label="+" open testId="fig-comment-draft-pin" />
              </div>
              <div
                class="absolute z-10 rounded-lg border border-edge-muted bg-panel p-2 shadow-lg"
                style={{ ...cardAt(at()), width: `${CARD}px` }}
                data-testid="fig-comment-draft"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <CommentComposer
                  placeholder="Add a comment"
                  testId="fig-comment-input"
                  autofocus
                  people={store.people}
                  onSubmit={(text, mentions) => c.post(text, mentions)}
                  onCancel={() => c.cancelDraft()}
                />
              </div>
            </>
          );
        }}
      </Show>
      <Show when={open()}>
        {(pin) => (
          <div
            class="absolute z-10 max-h-[60%] overflow-y-auto rounded-lg border border-edge-muted bg-panel p-3 shadow-lg"
            style={{ ...cardAt(screen(pin().at)), width: `${CARD}px` }}
            data-testid="fig-comment-popover"
            data-thread={pin().thread.id}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CommentThreadView
              thread={pin().thread}
              canComment={store.canComment()}
              canDelete={pin().thread.comments[0]?.author.id === store.me()?.id}
              people={store.people}
              onReply={(text, mentions) =>
                store.reply(pin().thread.id, text, mentions)
              }
              onResolve={(resolved) =>
                void store.setResolved(pin().thread.id, resolved)
              }
              onDelete={() => {
                const id = pin().thread.id;
                c.setOpenThread(undefined);
                void store.deleteThread(id);
              }}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
