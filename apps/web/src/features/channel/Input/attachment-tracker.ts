import { makePersisted } from '@solid-primitives/storage';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { InputAttachmentData } from './types';

export type InputAttachmentTracker = {
  attachments: Accessor<InputAttachmentData[]>;
  hasPending: Accessor<boolean>;
  /** True when the user clicked send while uploads were pending. */
  sendQueued: Accessor<boolean>;
  addAttachment: (attachment: InputAttachmentData) => void;
  removeAttachment: (attachmentId: string) => void;
  setAttachmentPending: (attachmentId: string, pending: boolean) => void;
  setAttachments: (attachments: InputAttachmentData[]) => void;
  clearAttachments: () => void;
  /** Queue or cancel a send-when-ready intent. */
  setSendQueued: (queued: boolean) => void;
};

type CreateInputAttachmentTrackerOptions = {
  persistenceKey?: string;
  initialAttachments?: InputAttachmentData[];
  maxAttachments?: number;
};

export function createInputAttachmentTracker(
  options: CreateInputAttachmentTrackerOptions = {}
): InputAttachmentTracker {
  const raw = createSignal<InputAttachmentData[]>(
    options.initialAttachments ?? []
  );

  const [attachments, setAttachments] = options.persistenceKey
    ? makePersisted(raw, {
        name: options.persistenceKey,
        serialize: (data: InputAttachmentData[]) =>
          JSON.stringify(data.filter((a) => !a.pending)),
        deserialize: (data: string) =>
          (JSON.parse(data) as InputAttachmentData[]).filter((a) => !a.pending),
      })
    : raw;

  const maxAttachments = options.maxAttachments ?? 10;
  const [sendQueued, setSendQueued] = createSignal(false);

  const hasPending = createMemo(() =>
    attachments().some((attachment) => attachment.pending === true)
  );

  const addAttachment = (attachment: InputAttachmentData) => {
    setAttachments((current) => {
      if (current.some((item) => item.id === attachment.id)) return current;
      if (current.length >= maxAttachments) return current;
      return [...current, attachment];
    });
  };

  const removeAttachment = (attachmentId: string) => {
    // Cancel queued send BEFORE removing — the user changed their mind or the
    // upload failed, so they should review before sending. Must run first so
    // the hasPending effect doesn't auto-send when the attachment list changes.
    setSendQueued(false);
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  };

  const setAttachmentPending = (attachmentId: string, pending: boolean) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === attachmentId ? { ...attachment, pending } : attachment
      )
    );
  };

  const replaceAttachments = (nextAttachments: InputAttachmentData[]) => {
    setAttachments(nextAttachments);
  };

  const clearAttachments = () => {
    // Cancel queued send BEFORE clearing — must run first so the hasPending
    // effect doesn't auto-send when the attachment list changes.
    setSendQueued(false);
    setAttachments([]);
  };

  return {
    attachments,
    hasPending,
    sendQueued,
    addAttachment,
    removeAttachment,
    setAttachmentPending,
    setAttachments: replaceAttachments,
    clearAttachments,
    setSendQueued,
  };
}
