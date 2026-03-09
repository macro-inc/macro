import type { Accessor } from 'solid-js';
import type {
  InputAttachmentData,
  InputCallbacks,
  InputCommands,
  InputData,
  InputDraftAdapter,
  InputSnapshot,
} from './types';

type CreateInputCommandsDeps = {
  view: Accessor<InputData>;
  snapshot: Accessor<InputSnapshot>;
  setIsSending: (value: boolean) => void;
  setShowFormatRibbon: (updater: (prev: boolean) => boolean) => void;
  reset: () => void;
  removeTrackedAttachment: (id: string) => void;
  attachFiles?: (files: File[]) => Promise<void> | void;
  callbacks?: InputCallbacks;
  draft?: InputDraftAdapter;
};

export function createInputCommands(
  deps: CreateInputCommandsDeps
): InputCommands {
  const removeAttachment = (attachment: InputAttachmentData) => {
    deps.removeTrackedAttachment(attachment.id);
    const current = deps.snapshot();
    void deps.callbacks?.onRemoveAttachment?.(attachment, current);
    void deps.draft?.save?.(current);
  };

  return {
    send: async () => {
      if (deps.view().hasPendingAttachments) return false;
      if (!deps.callbacks?.onSend) return false;

      const current = deps.snapshot();
      deps.setIsSending(true);
      try {
        await deps.callbacks.onSend(current);
        deps.reset();
        deps.draft?.clear?.();
        return true;
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
    closeDraft: () => {
      const current = deps.snapshot();
      deps.reset();
      deps.callbacks?.onCloseDraft?.(current);
      deps.draft?.clear?.();
    },
    removeAttachment,
  };
}
