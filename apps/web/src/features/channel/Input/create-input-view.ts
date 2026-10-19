import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { Telemetry } from '@macro-inc/observability';
import { makePersisted } from '@solid-primitives/storage';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputPersistenceKey,
  InputSnapshot,
} from './types';

type CreateInputViewOptions = {
  initialInput: InputData;
  mentions: Accessor<ItemMention[]>;
  attachmentTracker: InputAttachmentTracker;
  callbacks?: InputCallbacks;
  persistenceKey?: InputPersistenceKey;
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
  const rawValue = createSignal<string | undefined>(
    options.initialInput.value || undefined
  );
  const [persistedValue, setValueSignal] = options.persistenceKey
    ? makePersisted(rawValue, { name: options.persistenceKey })
    : rawValue;
  const value = () => persistedValue() ?? '';

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
        Promise.resolve(options.callbacks?.onChange?.(current)).catch((error) =>
          Telemetry.error(error, { surface: 'channel-input' })
        );
      },
      { defer: true }
    )
  );

  const setValue = (nextValue: string) => {
    setValueSignal(nextValue || undefined);
  };

  const reset = () => {
    setValue('');
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
