import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import type { GraphicsEditor, Point } from '@macro-inc/graphics';
import {
  capturePresence,
  type GraphicsPresence,
} from '@macro-inc/graphics/loro';
import { createEffect, on, onCleanup } from 'solid-js';
import type { CanvasSession } from '../queries/canvas-session';

/** Publish ephemeral gestures through the shared runtime's awareness channel. */
export function createCanvasPresence(
  editor: GraphicsEditor,
  session: CanvasSession,
  getClock: GraphicsPresence['getClock'],
  displayName: (userId: string | undefined) => string
): GraphicsPresence {
  let cursor: Point | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    clearTimeout(deadline);
    timer = deadline = undefined;
  };
  const publish = () => {
    clear();
    const presence = capturePresence(
      editor,
      {
        id: session.peerId,
        name: '',
        color: '',
      },
      getClock(),
      cursor
    );
    // Large selections/strokes retain cursors and selection awareness without
    // turning transient gestures into unbounded network payloads.
    presence.selectedIds = presence.selectedIds.slice(0, 1000);
    presence.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (
      JSON.stringify(presence).length > 128_000 ||
      (presence.preview?.shapes.length ?? 0) > 256 ||
      presence.preview?.shapes.some(
        (shape) => (shape.pencil?.points.length ?? 0) > 2048
      )
    )
      presence.preview = null;
    session.awareness.updateLocalAwareness(presence);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(publish, 40);
    deadline ??= setTimeout(publish, 100);
  };
  const gesture = () => {
    const current = editor.getSession();
    if (current.transform || current.box || editor.getPreview()) schedule();
    else publish();
  };
  const detach = [
    editor.subscribeSession(gesture),
    editor.subscribePreview(gesture),
    editor.subscribeDocument(publish),
  ];
  const heartbeat = setInterval(publish, 3000);
  const listeners = new Set<() => void>();
  createEffect(
    on([session.awareness.remote, session.status], () => {
      for (const listener of listeners) listener();
    })
  );
  onCleanup(() => {
    clear();
    clearInterval(heartbeat);
    detach.forEach((unsubscribe) => unsubscribe());
    listeners.clear();
    session.awareness.updateLocalAwareness(undefined);
  });
  publish();
  return {
    getClock,
    getRemote: () =>
      session.status() === SyncSourceStatus.Connected
        ? session.awareness.remote().flatMap((peer) =>
            peer.selection && peer.user && typeof peer.user.peerId === 'string'
              ? [
                  {
                    ...peer.selection,
                    id: peer.user.peerId,
                    name: peer.selection.name.endsWith('(AI)')
                      ? peer.selection.name.slice(0, 200)
                      : displayName(
                          typeof peer.user.userId === 'string'
                            ? peer.user.userId
                            : undefined
                        ),
                    color:
                      typeof peer.user.color === 'string' &&
                      /^[a-z]+$/.test(peer.user.color)
                        ? `var(--color-${peer.user.color}, var(--color-accent))`
                        : 'var(--color-accent)',
                  },
                ]
              : []
          )
        : [],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCursor(next) {
      cursor = next;
      if (next) schedule();
      else publish();
    },
  };
}
