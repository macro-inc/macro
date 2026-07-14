import type { InputSnapshot } from '@channel/Input';
import { toast } from '@core/component/Toast/Toast';
import type { NewChannelAttachment as NewAttachment } from '@service-storage/generated/schemas/newChannelAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import { type Accessor, createSignal } from 'solid-js';
import { expandMentions } from '../Input/message-payload';
import type { MessageData } from '../Message';
import type { MessageEditState } from '../Thread/types';
import {
  buildMessageEditSnapshot,
  getAttachmentIdsToDelete,
  getAttachmentsToAdd,
} from './message-editing';

type PatchMessageInput = {
  channelID: string;
  messageID: string;
  content: string;
  mentions: SimpleMention[];
  attachmentIDsToDelete?: string[];
  attachmentsToAdd?: NewAttachment[];
};

type CreateMessageEditorOptions = {
  channelId: () => string;
  participantIds: () => string[];
  patchMessage: (input: PatchMessageInput) => void;
  /**
   * Called when an edit session ends — saved, cancelled, or abandoned by
   * starting an edit on a different message.
   */
  onEditEnded?: (message: MessageData) => void;
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

  const endEdit = (message: MessageData) => {
    setEditState(undefined);
    options.onEditEnded?.(message);
  };

  const start: MessageEditor['start'] = (message: MessageData) => {
    const previous = editState();
    if (previous && previous.messageId !== message.id) {
      options.onEditEnded?.(previous.message);
    }
    setEditState({
      messageId: message.id,
      message,
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
    const current = editState();
    if (!current || current.messageId !== messageId) return;
    endEdit(current.message);
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

    const newAttachments = getAttachmentsToAdd({
      currentAttachments: message.attachments,
      nextSnapshot: snapshot,
    });

    const hasContentChanged = nextContent !== message.content;
    const hasAttachmentChanges =
      attachmentIDsToDelete.length > 0 || newAttachments.length > 0;
    if (!hasContentChanged && !hasAttachmentChanges) {
      endEdit(message);
      return;
    }

    options.patchMessage({
      channelID: options.channelId(),
      messageID: message.id,
      content: nextContent,
      mentions: expandMentions(snapshot.mentions, options.participantIds()),
      attachmentIDsToDelete,
      attachmentsToAdd: newAttachments.length > 0 ? newAttachments : undefined,
    });
    endEdit(message);
  };

  return {
    state: editState,
    save,
    update,
    cancel,
    start,
  };
}
