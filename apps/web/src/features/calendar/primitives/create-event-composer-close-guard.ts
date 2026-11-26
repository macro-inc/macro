export interface EventComposerCloseGuardOptions {
  confirmDiscard: () => Promise<boolean>;
  onBeforeClose?: () => void;
}

/** One close decision shared by every dismissal path of one composer session. */
export function createEventComposerCloseGuard(
  options: EventComposerCloseGuardOptions
) {
  const state = {
    saved: false,
    dirty: false,
    pending: false,
    closed: false,
    disposed: false,
  };
  const needsConfirmation = () => state.dirty && !state.saved && !state.closed;

  // Navigation asks first but leaves the draft intact until navigation commits.
  const confirmClose = async (): Promise<boolean> => {
    if (state.closed || state.disposed || state.pending) return false;
    state.pending = true;
    try {
      if (needsConfirmation()) {
        const discard = await options.confirmDiscard();
        if (!discard) return false;
      }
      return !state.disposed;
    } finally {
      state.pending = false;
    }
  };

  const completeClose = (finishClose: () => void): boolean => {
    if (state.closed || state.disposed) return false;
    options.onBeforeClose?.();
    finishClose();
    state.closed = true;
    return true;
  };

  return {
    setDirty: (dirty: boolean) => {
      state.dirty = dirty;
    },
    markSaved: () => {
      state.saved = true;
    },
    needsConfirmation,
    confirmClose,
    completeClose,
    dispose: () => {
      state.disposed = true;
    },
  };
}
