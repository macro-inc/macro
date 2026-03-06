import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  type Accessor,
} from 'solid-js';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputDraftAdapter,
  InputSnapshot,
} from './types';

type CreateInputViewOptions = {
  initialInput: InputData;
  mentions: Accessor<ItemMention[]>;
  attachmentTracker: InputAttachmentTracker;
  callbacks?: InputCallbacks;
  draft?: InputDraftAdapter;
};

export type InputView = {
  view: Accessor<InputData>;
  snapshot: Accessor<InputSnapshot>;
  value: Accessor<string>;
  showFormatRibbon: Accessor<boolean>;
  isSending: Accessor<boolean>;
  setValue: (value: string) => void;
  setShowFormatRibbon: (updater: (prev: boolean) => boolean) => void;
  setIsSending: (value: boolean) => void;
  setIsDraggedOver: (value: boolean) => void;
  reset: () => void;
};

export function createInputView(options: CreateInputViewOptions): InputView {
  const [value, setValueSignal] = createSignal(
    options.initialInput.value ?? ''
  );
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(
    !!options.initialInput.showFormatRibbon
  );
  const [isSending, setIsSending] = createSignal(false);
  const [isDraggedOver, setIsDraggedOver] = createSignal(false);

  const snapshot = createMemo<InputSnapshot>(() => ({
    value: value(),
    mentions: options.mentions(),
    attachments: options.attachmentTracker.attachments(),
  }));

  const view = createMemo<InputData>(() => ({
    ...options.initialInput,
    value: value(),
    isDraggedOver: isDraggedOver() || options.initialInput.isDraggedOver,
    showFormatRibbon: showFormatRibbon(),
    hasPendingAttachments:
      isSending() || options.attachmentTracker.hasPending(),
    attachments: options.attachmentTracker.attachments(),
  }));

  createEffect(
    on(
      snapshot,
      (current) => {
        void options.callbacks?.onChange?.(current);
        void options.draft?.save?.(current);
      },
      { defer: true }
    )
  );

  const setValue = (nextValue: string) => {
    setValueSignal(nextValue);
  };

  const reset = () => {
    setValueSignal('');
    options.attachmentTracker.clearAttachments();
  };

  return {
    view,
    snapshot,
    value,
    showFormatRibbon,
    isSending,
    setValue,
    setShowFormatRibbon,
    setIsSending,
    setIsDraggedOver,
    reset,
  };
}
