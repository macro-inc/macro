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
      const onSend = deps.callbacks?.onSend;
      if (!onSend) return false;

      const current = deps.snapshot();
      if (!hasSendableInputContent(current)) return false;
      return Telemetry.span('message.composer_send', async (span) => {
        span.setAttr('composer.mode', deps.view().mode);
        hapticImpact('light');
        deps.setIsSending(true);
        // Clear before delivery. The optimistic message paints as soon as
        // onSend mutates, and waiting for that promise lets the sent text
        // stay in the box — a second copy — until the request settles.
        deps.reset();
        deps.clearComposer?.();
        try {
          await onSend(current);
          span.setAttr('composer.outcome', 'dispatched');
          return true;
        } catch (error) {
          const draft = deps.snapshot();
          if (
            draft.value.trim().length === 0 &&
            draft.attachments.length === 0 &&
            draft.mentions.length === 0
          ) {
            deps.restoreSnapshot?.(current);
            span.setAttr('composer.outcome', 'restored');
          } else {
            span.setAttr('composer.outcome', 'preserved_newer_draft');
          }
          span.error('Message send failed');
          throw error;
        } finally {
          deps.setIsSending(false);
        }
      });
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
