import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import type { WhatsAppGroupCapabilities } from '../context/whatsapp-group-context';
import {
  canChangeMessage,
  type GroupMessage,
  type GroupSend,
} from '../core/group';

/** Drafts survive background refresh; failed and unknown sends are never retried. */
export function createConversation(
  source: WhatsAppGroupCapabilities,
  userId: Accessor<string | undefined>
) {
  const [draft, setDraft] = createSignal('');
  const [quote, setQuote] = createSignal<GroupMessage>();
  const [editing, setEditing] = createSignal<GroupMessage>();
  const [file, setFile] = createSignal<File>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [initialRead, setInitialRead] = createSignal<string>();
  const [initialUnreadCount, setInitialUnreadCount] = createSignal(0);
  const [readCaptured, setReadCaptured] = createSignal(false);
  let marked: string | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  createEffect(() => {
    const group = source.group.data;
    if (group && !readCaptured()) {
      setInitialRead(group.lastReadMessageId);
      setInitialUnreadCount(group.unreadCount);
      setReadCaptured(true);
    }
  });
  const markRead = async () => {
    const id = source.timeline.data?.at(-1)?.id;
    if (!id || id === marked || document.visibilityState === 'hidden') return;
    try {
      await source.markRead(id);
      if (!disposed) marked = id;
    } catch {
      if (!disposed) setError("Couldn't mark these messages as read.");
    }
  };
  const submit = async () => {
    const group = source.group.data;
    const senderId = userId();
    if (!group?.canSend || busy() || (!draft().trim() && !file())) return;
    if (
      new TextEncoder().encode(draft().trim()).length > group.limits.textBytes
    ) {
      setError('This message is too long for WhatsApp.');
      return;
    }
    const selected = file();
    if (
      selected &&
      (selected.size > group.limits.attachmentBytes ||
        !group.limits.attachmentTypes.includes(selected.type))
    ) {
      setError('This file type or size is not supported by WhatsApp.');
      return;
    }
    const text = draft().trim();
    if (selected?.type.startsWith('audio/') && text) {
      setError('Send audio without a caption. Your text is kept below.');
      return;
    }
    const replyTo = quote()?.id;
    const edit = editing();
    if (edit && selected) {
      setError('Attachments cannot be changed while editing a message.');
      return;
    }
    if (edit && !canChangeMessage(edit, userId(), group, Date.now(), 'edit')) {
      setError('This message can no longer be edited.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      let request: GroupSend;
      if (edit) request = { kind: 'edit', messageId: edit.id, text };
      else if (selected) {
        const uploaded = await source.upload(selected);
        if (disposed) return;
        if (uploaded.audio && text) {
          setError('Send audio without a caption. Your text is kept below.');
          return;
        }
        request = {
          kind: 'media',
          uploadId: uploaded.uploadId,
          caption: text || undefined,
          replyTo,
        };
      } else request = { kind: 'text', text, replyTo };
      if (disposed || userId() !== senderId || !source.group.data?.canSend)
        return;
      await source.send(request, crypto.randomUUID());
      if (disposed) return;
      setDraft('');
      setFile(undefined);
      setQuote(undefined);
      setEditing(undefined);
    } catch {
      if (!disposed)
        setError(
          "Couldn't confirm this send. Check WhatsApp and pending messages before trying again."
        );
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  const mutate = async (request: GroupSend) => {
    const group = source.group.data;
    if (!group?.canSend || busy()) return;
    if (
      request.kind === 'reaction' &&
      !group.limits.mutations.includes('reaction')
    )
      return;
    if (request.kind === 'delete' || request.kind === 'edit') {
      const message = source.timeline.data?.find(
        (item) => item.id === request.messageId
      );
      if (
        !message ||
        !canChangeMessage(message, userId(), group, Date.now(), request.kind)
      ) {
        setError('This message can no longer be changed.');
        return;
      }
    }
    setBusy(true);
    setError(undefined);
    try {
      await source.send(request, crypto.randomUUID());
    } catch {
      if (!disposed)
        setError(
          "Couldn't confirm this change. Check WhatsApp before trying again."
        );
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  return {
    draft,
    setDraft,
    quote,
    editing,
    file,
    setFile,
    busy,
    error,
    initialRead,
    initialUnreadCount,
    markRead,
    submit,
    mutate,
    reply: (message: GroupMessage) => {
      setQuote(message);
      setEditing(undefined);
    },
    edit: (message: GroupMessage) => {
      setEditing(message);
      setQuote(undefined);
      setDraft(message.body);
      setFile(undefined);
    },
    cancelTarget: () => {
      if (editing()) setDraft('');
      setEditing(undefined);
      setQuote(undefined);
    },
  };
}
export type Conversation = ReturnType<typeof createConversation>;
