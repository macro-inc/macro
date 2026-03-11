import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { Accessor } from 'solid-js';
import { createInputView } from './create-input-view';
import { createInputCommands } from './create-input-commands';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputCommands,
  InputData,
  InputPersistenceKey,
  InputSnapshot,
} from './types';

type CreateInputStateOptions = {
  initialInput: InputData;
  mentions: Accessor<ItemMention[]>;
  attachmentTracker: InputAttachmentTracker;
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
    setIsSending: view.setIsSending,
    setShowFormatRibbon: view.setShowFormatRibbon,
    reset: () => {
      view.reset();
      options.clearInput?.();
    },
    removeTrackedAttachment: (id) =>
      options.attachmentTracker.removeAttachment(id),
    attachFiles: options.attachFiles,
    callbacks: options.callbacks,
  });

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
