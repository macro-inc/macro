import type { Accessor } from 'solid-js';
import type {
  InputAttachmentData,
  InputCallbacks,
  InputCommands,
  InputData,
  InputSnapshot,
} from './types';
import { hasSendableInputContent } from './utils/sendable-content';

type CreateInputCommandsDeps = {
  view: Accessor<InputData>;
  snapshot: Accessor<InputSnapshot>;
  setIsSending: (value: boolean) => void;
  setShowFormatRibbon: (updater: (prev: boolean) => boolean) => void;
  reset: () => void;
  /** Puts a failed send's draft back after the optimistic clear. */
  restoreSnapshot?: (snapshot: InputSnapshot) => void;
  clearComposer?: () => void;
  removeTrackedAttachment: (id: string) => void;
  attachFiles?: (files: File[]) => Promise<void> | void;
  callbacks?: InputCallbacks;
};

export function createInputCommands(
  deps: CreateInputCommandsDeps
): InputCommands {
  const removeAttachment = (attachment: InputAttachmentData) => {
    deps.removeTrackedAttachment(attachment.id);
    const current = deps.snapshot();
    void deps.callbacks?.onRemoveAttachment?.(attachment, current);
  };

  return {
    send: async () => {
      if (deps.view().hasPendingAttachments) return false;
      if (!deps.callbacks?.onSend) return false;

      const current = deps.snapshot();
      if (!hasSendableInputContent(current)) return false;
      deps.setIsSending(true);
      // Clear before delivery. The optimistic message paints as soon as
      // onSend mutates, and waiting for that promise lets the sent text
      // stay in the box — a second copy — until the request settles.
      deps.reset();
      deps.clearComposer?.();
      try {
        await deps.callbacks.onSend(current);
        return true;
      } catch (error) {
        deps.restoreSnapshot?.(current);
        throw error;
      } finally {
        deps.setIsSending(false);
      }
    },
    attachFiles: async (files: File[]) => {
      if (files.length === 0) return;
      await deps.attachFiles?.(files);
    },
    toggleFormatRibbon: () => {
      deps.setShowFormatRibbon((open) => {
        const next = !open;
        deps.callbacks?.onToggleFormatRibbon?.(next);
        return next;
      });
    },
    close: () => {
      const current = deps.snapshot();
      deps.reset();
      deps.clearComposer?.();
      deps.callbacks?.onClose?.(current);
    },
    removeAttachment,
  };
}
