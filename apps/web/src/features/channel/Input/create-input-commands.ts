import { hapticImpact } from '@core/mobile/haptics';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
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
  clearComposer?: () => void;
  removeTrackedAttachment: (id: string) => void;
  attachFiles?: (files: File[]) => Promise<void> | void;
  callbacks?: InputCallbacks;
};

export function createInputCommands(
  deps: CreateInputCommandsDeps
): InputCommands {
  const reportCallbackError = (error: unknown) =>
    Telemetry.error(error, { surface: 'channel-input' });

  const removeAttachment = (attachment: InputAttachmentData) => {
    deps.removeTrackedAttachment(attachment.id);
    const current = deps.snapshot();
    fireAndForget(
      deps.callbacks?.onRemoveAttachment?.(attachment, current),
      'channel-input'
    );
  };

  return {
    send: async () => {
      if (deps.view().hasPendingAttachments) return false;
      if (!deps.callbacks?.onSend) return false;

      const current = deps.snapshot();
      if (!hasSendableInputContent(current)) return false;
      hapticImpact('light');
      deps.setIsSending(true);
      try {
        await deps.callbacks.onSend(current);
        deps.reset();
        deps.clearComposer?.();
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
        Promise.resolve(deps.callbacks?.onToggleFormatRibbon?.(next)).catch(
          reportCallbackError
        );
        return next;
      });
    },
    close: () => {
      const current = deps.snapshot();
      deps.reset();
      deps.clearComposer?.();
      Promise.resolve(deps.callbacks?.onClose?.(current)).catch(
        reportCallbackError
      );
    },
    removeAttachment,
  };
}
