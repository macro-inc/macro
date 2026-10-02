/**
 * Unsent text and attachments for one agent session.
 *
 * The composer unmounts when the session leaves the screen. These drafts are
 * keyed by session id, the same way a channel keeps its reply, so coming back
 * restores what was about to be sent. A session id that arrives after the
 * composer mounts (the create is still on the wire) takes over the text and
 * files already in the box.
 */

import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import type {
  InputAttachmentData,
  InputAttachmentTracker,
} from '@channel/Input/types';
import { createPersistenceKey } from '@queries/persistence';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  untrack,
} from 'solid-js';

export function agentSessionDraftKey(sessionId: string) {
  return createPersistenceKey(`input-value-agent-session:${sessionId}`, 0);
}

export function agentSessionAttachmentsKey(sessionId: string) {
  return createPersistenceKey(
    `attachment-tracker-agent-session:${sessionId}`,
    0
  );
}

function readJson(key: string | undefined): unknown {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function writeJson(key: string | undefined, value: unknown) {
  if (!key) return;
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store leaves the in-memory draft usable.
  }
}

function readDraft(sessionId: string | undefined): string | undefined {
  const parsed = readJson(
    sessionId ? agentSessionDraftKey(sessionId) : undefined
  );
  return typeof parsed === 'string' && parsed.length > 0 ? parsed : undefined;
}

function writeDraft(sessionId: string | undefined, value: string) {
  writeJson(
    sessionId ? agentSessionDraftKey(sessionId) : undefined,
    value.length > 0 ? value : undefined
  );
}

function isAttachment(value: unknown): value is InputAttachmentData {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as InputAttachmentData).id === 'string' &&
    !(value as InputAttachmentData).pending
  );
}

function readAttachments(sessionId: string | undefined): InputAttachmentData[] {
  const parsed = readJson(
    sessionId ? agentSessionAttachmentsKey(sessionId) : undefined
  );
  return Array.isArray(parsed) ? parsed.filter(isAttachment) : [];
}

function writeAttachments(
  sessionId: string | undefined,
  attachments: InputAttachmentData[]
) {
  const settled = attachments.filter((attachment) => !attachment.pending);
  writeJson(
    sessionId ? agentSessionAttachmentsKey(sessionId) : undefined,
    settled.length > 0 ? settled : undefined
  );
}

/** Text waiting to be sent into this session. */
export function createSessionComposerDraft(
  sessionId: Accessor<string | undefined>,
  initial?: Accessor<string | undefined>
) {
  const startingId = untrack(sessionId);
  const [text, setText] = createSignal(
    readDraft(startingId) ?? untrack(() => initial?.()) ?? ''
  );
  let currentId = startingId;

  const setDraft = (value: string) => {
    setText(value);
    writeDraft(currentId, value);
  };

  createEffect(
    on(
      sessionId,
      (id) => {
        if (id === currentId) return;
        const value = untrack(text);
        if (currentId) writeDraft(currentId, '');
        currentId = id;
        if (!id) return;
        if (value) {
          writeDraft(id, value);
          return;
        }
        const stored = readDraft(id);
        if (stored) setText(stored);
      },
      { defer: true }
    )
  );

  return { draft: text, setDraft };
}

/** Files waiting to be sent into this session. Uploads still in flight are not kept. */
export function createSessionAttachmentTracker(
  sessionId: Accessor<string | undefined>
): InputAttachmentTracker {
  const startingId = untrack(sessionId);
  const tracker = createInputAttachmentTracker({
    initialAttachments: readAttachments(startingId),
  });
  let currentId = startingId;

  const persist = () => writeAttachments(currentId, tracker.attachments());

  createEffect(
    on(
      sessionId,
      (id) => {
        if (id === currentId) return;
        const current = untrack(tracker.attachments);
        if (currentId) writeAttachments(currentId, []);
        currentId = id;
        if (!id) return;
        if (current.some((attachment) => !attachment.pending)) {
          writeAttachments(id, current);
          return;
        }
        const stored = readAttachments(id);
        if (stored.length > 0) tracker.setAttachments(stored);
      },
      { defer: true }
    )
  );

  return {
    attachments: tracker.attachments,
    hasPending: tracker.hasPending,
    addAttachment: (attachment) => {
      tracker.addAttachment(attachment);
      persist();
    },
    removeAttachment: (attachmentId) => {
      tracker.removeAttachment(attachmentId);
      persist();
    },
    setAttachmentPending: (attachmentId, pending) => {
      tracker.setAttachmentPending(attachmentId, pending);
      persist();
    },
    setAttachments: (attachments) => {
      tracker.setAttachments(attachments);
      persist();
    },
    clearAttachments: () => {
      tracker.clearAttachments();
      persist();
    },
  };
}
