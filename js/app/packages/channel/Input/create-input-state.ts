import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { createMemo, createSignal, type Accessor } from 'solid-js';
import type {
  InputAttachmentData,
  InputAttachmentTracker,
  InputCallbacks,
  InputCommands,
  InputData,
  InputDraftAdapter,
  InputSnapshot,
} from './types';

type CreateInputStateOptions = {
  initialInput: InputData;
  mentions: Accessor<ItemMention[]>;
  attachmentTracker: InputAttachmentTracker;
  callbacks?: InputCallbacks;
  draft?: InputDraftAdapter;
};

export type InputState = {
  view: Accessor<InputData>;
  snapshot: Accessor<InputSnapshot>;
  commands: InputCommands;
  setValue: (value: string) => void;
  notifyChange: () => void;
  reset: () => void;
};

export function createInputState(options: CreateInputStateOptions): InputState {
  const [value, setValueSignal] = createSignal(
    options.initialInput.value ?? ''
  );
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(
    !!options.initialInput.showFormatRibbon
  );
  const [showAttachMenu, setShowAttachMenu] = createSignal(
    !!options.initialInput.showAttachMenu
  );
  const [isSending, setIsSending] = createSignal(false);

  const snapshot = createMemo<InputSnapshot>(() => ({
    value: value(),
    mentions: options.mentions(),
    attachments: options.attachmentTracker.attachments(),
  }));

  const view = createMemo<InputData>(() => ({
    ...options.initialInput,
    value: value(),
    showFormatRibbon: showFormatRibbon(),
    showAttachMenu: showAttachMenu(),
    hasPendingAttachments:
      isSending() || options.attachmentTracker.hasPending(),
    attachments: options.attachmentTracker.attachments(),
  }));

  const emitChange = () => {
    const current = snapshot();
    void options.callbacks?.onChange?.(current);
    void options.draft?.save?.(current);
  };

  const setValue = (nextValue: string) => {
    setValueSignal(nextValue);
    emitChange();
  };

  const reset = () => {
    setValueSignal('');
    options.attachmentTracker.clearAttachments();
    setShowAttachMenu(false);
  };

  const removeAttachment = (attachment: InputAttachmentData) => {
    options.attachmentTracker.removeAttachment(attachment.id);
    const current = snapshot();
    void options.callbacks?.onRemoveAttachment?.(attachment, current);
    void options.draft?.save?.(current);
  };

  const commands: InputCommands = {
    send: async () => {
      if (view().hasPendingAttachments) return false;
      if (!options.callbacks?.onSend) return false;

      const current = snapshot();
      setIsSending(true);
      try {
        await options.callbacks.onSend(current);
        reset();
        options.draft?.clear?.();
        return true;
      } finally {
        setIsSending(false);
      }
    },
    toggleAttachMenu: () => {
      setShowAttachMenu((open) => {
        const next = !open;
        options.callbacks?.onToggleAttachMenu?.(next);
        return next;
      });
    },
    toggleFormatRibbon: () => {
      setShowFormatRibbon((open) => {
        const next = !open;
        options.callbacks?.onToggleFormatRibbon?.(next);
        return next;
      });
    },
    toggleTaskMode: () => {
      // No-op: task mode is now managed externally via createTaskMode.
      // Overridden by composition in ChannelInput.
    },
    closeDraft: () => {
      const current = snapshot();
      reset();
      options.callbacks?.onCloseDraft?.(current);
      options.draft?.clear?.();
    },
    removeAttachment,
  };

  return {
    view,
    snapshot,
    commands,
    setValue,
    notifyChange: emitChange,
    reset,
  };
}
