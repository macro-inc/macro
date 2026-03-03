import { createMemo, createSignal, type Accessor } from 'solid-js';
import type {
  InputActionContext,
  InputActions,
  InputAttachmentTracker,
  InputData,
  InputTaskData,
} from './types';

type MaybeAccessor<T> = T | Accessor<T>;

type CreateChannelInputControllerOptions = {
  inputId?: string;
  placeholder?: MaybeAccessor<string>;
  isReplyInput?: boolean;
  initialValue?: string;
  attachmentTracker: InputAttachmentTracker;
  onSend?: (
    context: InputActionContext & { value: string }
  ) => void | Promise<void>;
  onCloseDraft?: (context: InputActionContext) => void | Promise<void>;
};

export type ChannelInputController = {
  input: Accessor<InputData>;
  actions: InputActions;
  value: Accessor<string>;
  setValue: (value: string) => void;
};

function resolveAccessor<T>(
  value: MaybeAccessor<T> | undefined,
  fallback: T
): T {
  if (typeof value === 'function') {
    return (value as Accessor<T>)();
  }
  return value ?? fallback;
}

export function createChannelInputController(
  options: CreateChannelInputControllerOptions
): ChannelInputController {
  const [value, setValue] = createSignal(options.initialValue ?? '');
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const [showAttachMenu, setShowAttachMenu] = createSignal(false);
  const [taskModeEnabled, setTaskModeEnabled] = createSignal(false);
  const [isSending, setIsSending] = createSignal(false);

  const derivedTasks = createMemo<InputTaskData[]>(() => {
    if (!taskModeEnabled()) return [];
    return value()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 3)
      .map((title, index) => ({
        id: `task-${index + 1}`,
        title,
      }));
  });

  const input = createMemo<InputData>(() => ({
    id: options.inputId ?? 'channel-input-basic',
    placeholder: resolveAccessor(options.placeholder, 'Message channel'),
    value: value(),
    isReplyInput: options.isReplyInput,
    showFormatRibbon: showFormatRibbon(),
    showAttachMenu: showAttachMenu(),
    taskModeEnabled: taskModeEnabled(),
    hasPendingAttachments:
      isSending() || options.attachmentTracker.hasPending(),
    attachments: options.attachmentTracker.attachments(),
    tasks: derivedTasks(),
  }));

  const actions: InputActions = {
    onChange: (context) => {
      setValue(context.value ?? '');
    },
    onSend: async (context) => {
      if (input().hasPendingAttachments) return;

      setIsSending(true);
      try {
        await options.onSend?.({
          ...context,
          input: input(),
          value: value(),
        });
        setValue('');
        options.attachmentTracker.clearAttachments();
        setShowAttachMenu(false);
      } finally {
        setIsSending(false);
      }
    },
    onToggleAttachMenu: () => {
      setShowAttachMenu((open) => !open);
    },
    onToggleFormatRibbon: () => {
      setShowFormatRibbon((open) => !open);
    },
    onToggleTaskMode: () => {
      setTaskModeEnabled((enabled) => !enabled);
    },
    onCloseDraft: async (context) => {
      setValue('');
      options.attachmentTracker.clearAttachments();
      await options.onCloseDraft?.({ ...context, input: input() });
    },
    onRemoveAttachment: (context) => {
      if (!context.attachment) return;
      options.attachmentTracker.removeAttachment(context.attachment.id);
    },
  };

  return {
    input,
    actions,
    value,
    setValue,
  };
}
