import { toast } from '@core/component/Toast/Toast';
import { createSignal } from 'solid-js';
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

export function createMessageEditor(options: CreateMessageEditorOptions) {
  const [editState, setEditState] = createSignal<MessageEditState>();

  const startEditing = (message: MessageData) => {
    setEditState({
      messageId: message.id,
      snapshot: buildMessageEditSnapshot(message),
    });
  };

  const updateSnapshot = (_message: MessageData, snapshot: InputSnapshot) => {
    setEditState((current) =>
      current ? { ...current, snapshot } : current
    );
  };

  const cancelEditing = (messageId: string) => {
    if (editState()?.messageId !== messageId) return;
    setEditState(undefined);
  };

  const saveEditing = (message: MessageData, snapshot: InputSnapshot) => {
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
    editState,
    startEditing,
    updateSnapshot,
    cancelEditing,
    saveEditing,
  };
}
