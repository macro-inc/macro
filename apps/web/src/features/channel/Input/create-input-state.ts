import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { type Accessor, createEffect, on } from 'solid-js';
import { createInputCommands } from './create-input-commands';
import { createInputView } from './create-input-view';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputCommands,
  InputData,
  InputPersistenceKey,
  InputSnapshot,
} from './types';
import { hasSendableInputContent } from './utils/sendable-content';

type CreateInputStateOptions = {
  initialInput: InputData;
  mentions: Accessor<ItemMention[]>;
  attachmentTracker: InputAttachmentTracker;
  clearComposer?: () => void;
  attachFiles?: (files: File[]) => Promise<void> | void;
  clearInput?: () => void;
  callbacks?: InputCallbacks;
  persistenceKey?: InputPersistenceKey;
};

export type InputState = {
  view: Accessor<InputData>;
  snapshot: Accessor<InputSnapshot>;
  commands: InputCommands;
  setValue: (value: string) => void;
  setIsDraggedOver: (value: boolean) => void;
  reset: () => void;
};

export function createInputState(options: CreateInputStateOptions): InputState {
  const view = createInputView({
    initialInput: options.initialInput,
    mentions: options.mentions,
    attachmentTracker: options.attachmentTracker,
    callbacks: options.callbacks,
    persistenceKey: options.persistenceKey,
  });

  const commands = createInputCommands({
    view: view.view,
    snapshot: view.snapshot,
    attachmentTracker: options.attachmentTracker,
    setIsSending: view.setIsSending,
    setShowFormatRibbon: view.setShowFormatRibbon,
    // Sending/closing clears the editor once, through the focus-preserving path.
    clearComposer: options.clearComposer ?? options.clearInput,
    reset: view.reset,
    removeTrackedAttachment: (id) =>
      options.attachmentTracker.removeAttachment(id),
    attachFiles: options.attachFiles,
    callbacks: options.callbacks,
  });

  // Auto-send when uploads complete and a send was queued
  createEffect(
    on(
      () => options.attachmentTracker.hasPending(),
      (hasPending) => {
        if (hasPending) return;
        if (!options.attachmentTracker.sendQueued()) return;
        // Uploads finished and send was queued — send now if still valid
        const current = view.snapshot();
        if (!hasSendableInputContent(current)) {
          options.attachmentTracker.setSendQueued(false);
          return;
        }
        void commands.send();
      }
    )
  );

  return {
    view: view.view,
    snapshot: view.snapshot,
    commands,
    setValue: view.setValue,
    setIsDraggedOver: view.setIsDraggedOver,
    reset: () => {
      view.reset();
      options.clearInput?.();
    },
  };
}
