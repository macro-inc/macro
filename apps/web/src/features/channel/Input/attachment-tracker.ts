import { makePersisted } from '@solid-primitives/storage';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { createSharedDrafts } from './shared-draft';
import type { InputAttachmentData } from './types';

export type InputAttachmentTracker = {
  attachments: Accessor<InputAttachmentData[]>;
  hasPending: Accessor<boolean>;
  addAttachment: (attachment: InputAttachmentData) => void;
  removeAttachment: (attachmentId: string) => void;
  setAttachmentPending: (attachmentId: string, pending: boolean) => void;
  setAttachments: (attachments: InputAttachmentData[]) => void;
  clearAttachments: () => void;
};

type CreateInputAttachmentTrackerOptions = {
  persistenceKey?: string;
  initialAttachments?: InputAttachmentData[];
  maxAttachments?: number;
};

const holdStoredAttachments = createSharedDrafts<InputAttachmentTracker>();

/**
 * The files attached to a draft. With a `persistenceKey`, every input holding
 * that key shares one tracker; call it inside the owner that uses it.
 */
export function createInputAttachmentTracker(
  options: CreateInputAttachmentTrackerOptions = {}
): InputAttachmentTracker {
  const { persistenceKey } = options;
  if (!persistenceKey) return buildAttachmentTracker(options);

  return holdStoredAttachments(persistenceKey, () =>
    buildAttachmentTracker(options)
  );
}

function buildAttachmentTracker(
  options: CreateInputAttachmentTrackerOptions
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
    setAttachments([]);
  };

  return {
    attachments,
    hasPending,
    addAttachment,
    removeAttachment,
    setAttachmentPending,
    setAttachments: replaceAttachments,
    clearAttachments,
  };
}
