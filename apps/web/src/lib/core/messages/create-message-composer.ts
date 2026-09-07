import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import { createInputState } from '@channel/Input/create-input-state';
import { createTypingTracker } from '@channel/Input/create-typing-tracker';
import { createMentionsTracker } from '@channel/Input/mentions-tracker';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputPersistenceKey,
} from '@channel/Input/types';

type ComposerOptions = {
  input: InputData;
  callbacks: InputCallbacks;
  attachmentTracker?: InputAttachmentTracker;
  persistenceKey?: InputPersistenceKey;
  clearEditor: () => void;
  attachFiles: (files: File[]) => Promise<void>;
  trackTyping?: () => boolean;
  onSendError?: (error: unknown) => void;
};

/** Shared draft, mention, attachment, send, and typing lifecycle for every message surface. */
export function createMessageComposer(options: ComposerOptions) {
  const mentionsTracker = createMentionsTracker();
  const attachmentTracker =
    options.attachmentTracker ??
    createInputAttachmentTracker({
      initialAttachments: options.input.attachments,
    });
  const typingTracker = createTypingTracker({
    onStartTyping: () => options.callbacks.onStartTyping?.(),
    onStopTyping: () => options.callbacks.onStopTyping?.(),
  });
  const state = createInputState({
    initialInput: options.input,
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    persistenceKey: options.persistenceKey,
    attachFiles: options.attachFiles,
    clearComposer: () => {
      mentionsTracker.setMentions([]);
      options.clearEditor();
    },
    callbacks: {
      onChange: options.callbacks.onChange,
      onToggleFormatRibbon: options.callbacks.onToggleFormatRibbon,
      onRemoveAttachment: options.callbacks.onRemoveAttachment,
      onSend: options.callbacks.onSend
        ? async (snapshot) => {
            typingTracker.stop();
            await options.callbacks.onSend?.(snapshot);
          }
        : undefined,
      onClose: (snapshot) => {
        typingTracker.stop();
        options.callbacks.onClose?.(snapshot);
      },
    },
  });
  const inputState = {
    ...state,
    commands: {
      ...state.commands,
      send: async () => {
        try {
          return await state.commands.send();
        } catch (error) {
          if (!options.onSendError) throw error;
          options.onSendError(error);
          return false;
        }
      },
    },
  };
  const onChange = (markdown: string) => {
    const previous = inputState.view().value ?? '';
    inputState.setValue(markdown);
    if (
      options.trackTyping?.() === false ||
      markdown.trim() === previous.trim()
    )
      return;
    typingTracker.keystroke();
  };
  return {
    inputState,
    mentionsTracker,
    attachmentTracker,
    typingTracker,
    onChange,
  };
}
