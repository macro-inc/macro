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
      const session: ComposerSession = {
        key: ++nextKey,
        request,
        guard: createEventComposerCloseGuard({
          confirmDiscard: options.confirmDiscard,
          onBeforeClose: request.onClose,
        }),
      };
      setState({ session, pinned: false });
      return session.key;
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
    close,
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
