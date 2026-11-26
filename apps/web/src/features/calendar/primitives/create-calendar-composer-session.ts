import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ComposerOpenRequest } from '../core/composer-session';
import { createEventComposerCloseGuard } from './create-event-composer-close-guard';

interface ComposerSession {
  key: number;
  request: ComposerOpenRequest;
  guard: ReturnType<typeof createEventComposerCloseGuard>;
}

/** One editor identity survives pinning; replacement waits for the same close guard as dismissal. */
export function createCalendarComposerSession(options: {
  confirmDiscard: () => Promise<boolean>;
}) {
  const [state, setState] = createStore<{
    session: ComposerSession | undefined;
    pinned: boolean;
    transitioning: boolean;
  }>({ session: undefined, pinned: false, transitioning: false });
  let nextKey = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    state.session?.guard.dispose();
  });
  const createSession = (request: ComposerOpenRequest): ComposerSession => ({
    key: ++nextKey,
    request,
    guard: createEventComposerCloseGuard({
      confirmDiscard: options.confirmDiscard,
      onBeforeClose: request.onClose,
    }),
  });

  const finishClose = (session: ComposerSession) =>
    session.guard.completeClose(() => {
      setState({ session: undefined, pinned: false });
      session.guard.dispose();
    });

  const open = async (
    request: ComposerOpenRequest
  ): Promise<number | undefined> => {
    if (disposed || state.transitioning) return undefined;
    setState('transitioning', true);
    try {
      const previous = state.session;
      if (previous) {
        const approved = await previous.guard.confirmClose();
        if (!approved || disposed) return undefined;
        if (!finishClose(previous)) return undefined;
      }
      if (disposed) return undefined;
      const session = createSession(request);
      setState({ session, pinned: false });
      return session.key;
    } finally {
      if (!disposed) setState('transitioning', false);
    }
  };
  /** Re-read selection after approval so a pending prompt never opens an obsolete occurrence. */
  const replacePinned = async (
    expectedKey: number,
    resolveLatest: () => ComposerOpenRequest | undefined
  ): Promise<number | undefined> => {
    const previous = state.session;
    if (
      disposed ||
      state.transitioning ||
      !state.pinned ||
      previous?.key !== expectedKey
    )
      return undefined;
    const requested = resolveLatest();
    if (!requested?.event) return undefined;
    if (requested.event.id === previous.request.event?.id) return previous.key;

    setState('transitioning', true);
    try {
      if (!(await previous.guard.confirmClose())) return undefined;
      if (disposed || state.session?.key !== expectedKey || !state.pinned)
        return undefined;
      const current = resolveLatest();
      if (!current?.event) return undefined;
      if (current.event.id === previous.request.event?.id) return previous.key;

      const next = createSession(current);
      // Install the replacement directly: clearing the old session would collapse the dock.
      const closed = previous.guard.completeClose(() => {
        setState({ session: next, pinned: true });
        previous.guard.dispose();
      });
      return closed ? next.key : undefined;
    } finally {
      if (!disposed) setState('transitioning', false);
    }
  };

  const close = async (key: number): Promise<boolean> => {
    const session = state.session;
    if (disposed || state.transitioning || session?.key !== key) return false;
    setState('transitioning', true);
    try {
      const approved = await session.guard.confirmClose();
      return approved && !disposed && finishClose(session);
    } finally {
      if (!disposed) setState('transitioning', false);
    }
  };

  return {
    state,
    open,
    replacePinned,
    close,
    completeClose: (key: number) => {
      const session = state.session;
      if (disposed || session?.key !== key) return false;
      return finishClose(session);
    },
    setPinned: (key: number, pinned: boolean) => {
      if (!disposed && state.session?.key === key) setState('pinned', pinned);
    },
    setDirty: (key: number, dirty: boolean) => {
      if (!disposed && state.session?.key === key)
        state.session.guard.setDirty(dirty);
    },
    markSaved: (key: number) => {
      if (!disposed && state.session?.key === key)
        state.session.guard.markSaved();
    },
    hasUnsavedChanges: () =>
      !disposed && (state.session?.guard.needsConfirmation() ?? false),
  };
}

export type CalendarComposerSession = ReturnType<
  typeof createCalendarComposerSession
>;
