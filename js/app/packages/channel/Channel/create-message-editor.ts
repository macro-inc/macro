import { toast } from '@core/component/Toast/Toast';
import { createSignal, type Accessor } from 'solid-js';
import type { InputSnapshot } from '@channel/Input';
import type { MessageData } from '../Message';
import type { MessageEditState } from '../Thread/types';
import {
  buildMessageEditSnapshot,
  getAttachmentIdsToDelete,
} from './message-editing';

type PatchMessageInput = {
  channelID: string;
  messageID: string;
  content: string;
  attachmentIDsToDelete?: string[];
};

type CreateMessageEditorOptions = {
  channelId: () => string;
  patchMessage: (input: PatchMessageInput) => void;
};

export type MessageEditor = {
  state: Accessor<MessageEditState | undefined>;
  update: (message: MessageData, snapshot: InputSnapshot) => void;
  cancel: (messageId: string) => void;
  start: (message: MessageData) => void;
  save: (message: MessageData, snapshot: InputSnapshot) => void;
};

export function createMessageEditor(
  options: CreateMessageEditorOptions
): MessageEditor {
  const [editState, setEditState] = createSignal<MessageEditState>();

  const start: MessageEditor['start'] = (message: MessageData) => {
    setEditState({
      messageId: message.id,
      snapshot: buildMessageEditSnapshot(message),
    });
  };

  const update: MessageEditor['update'] = (
    _message: MessageData,
    snapshot: InputSnapshot
  ) => {
    setEditState((current) => (current ? { ...current, snapshot } : current));
  };

  const cancel: MessageEditor['cancel'] = (messageId: string) => {
    if (editState()?.messageId !== messageId) return;
    setEditState(undefined);
  };

  const save: MessageEditor['save'] = (message, snapshot) => {
    const nextContent = snapshot.value.trim();
    if (nextContent.length === 0 && snapshot.attachments.length === 0) {
      toast.failure('Message cannot be empty');
      return;
    }

    const attachmentIDsToDelete = getAttachmentIdsToDelete({
      currentAttachments: message.attachments,
      nextSnapshot: snapshot,
    });

    const hasContentChanged = nextContent !== message.content;
    const hasRemovedAttachments = attachmentIDsToDelete.length > 0;
    if (!hasContentChanged && !hasRemovedAttachments) {
      setEditState(undefined);
      return;
    }

    options.patchMessage({
      channelID: options.channelId(),
      messageID: message.id,
      content: nextContent,
      attachmentIDsToDelete,
    });
    setEditState(undefined);
  };

  return {
    state: editState,
    save,
    update,
    cancel,
    start,
  };
}
