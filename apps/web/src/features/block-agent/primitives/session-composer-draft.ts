/**
 * Unsent text and attachments for one agent session.
 *
 * The composer unmounts when the session leaves the screen. These drafts are
 * keyed by session id, the same way a channel keeps its reply, so coming back
 * restores what was about to be sent. A session id that arrives after the
 * composer mounts (the create is still on the wire) takes over the text and
 * files already in the box.
 */

import {
  createInputAttachmentTracker,
  DEFAULT_MAX_ATTACHMENTS,
} from '@channel/Input/attachment-tracker';
import type {
  InputAttachmentData,
  InputAttachmentTracker,
} from '@channel/Input/types';
import { toast } from '@core/component/Toast/Toast';
import { createPersistenceKey } from '@queries/persistence';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
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
  return typeof parsed === 'string' && parsed.trim().length > 0
    ? parsed
    : undefined;
}

function writeDraft(sessionId: string | undefined, value: string) {
  writeJson(
    sessionId ? agentSessionDraftKey(sessionId) : undefined,
    value.trim().length > 0 ? value : undefined
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

/** Takes a refused message's text or files into one open composer. */
type Receiver<Value> = (value: Value) => void;

/**
 * The composers open on each session. A refusal can land after the composer
 * that sent it is gone; it must reach the one open on that session now, which
 * would otherwise overwrite storage with its own state on the next keystroke.
 */
function createReceivers<Value>() {
  const open = new Map<string, Receiver<Value>[]>();
  return {
    add(id: string | undefined, receive: Receiver<Value>) {
      if (id) open.set(id, [...(open.get(id) ?? []), receive]);
    },
    remove(id: string | undefined, receive: Receiver<Value>) {
      if (!id) return;
      const rest = (open.get(id) ?? []).filter((each) => each !== receive);
      if (rest.length > 0) open.set(id, rest);
      else open.delete(id);
    },
    /** The sender while it is still open on `id`, else the newest one. */
    find(id: string, own: Receiver<Value>): Receiver<Value> | undefined {
      const receivers = open.get(id) ?? [];
      return receivers.includes(own) ? own : receivers.at(-1);
    },
  };
}

const DRAFT_RECEIVERS = createReceivers<string>();
const ATTACHMENT_RECEIVERS = createReceivers<InputAttachmentData[]>();

function prependMessage(message: string, current: string) {
  return [message, current]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

/**
 * A refused message's files back ahead of those attached since, as far as the
 * draft's cap allows. Like a file attached to a full composer, one that no
 * longer fits is turned away with the same notice.
 */
function addMissing(
  attachments: InputAttachmentData[],
  current: InputAttachmentData[]
) {
  const missing = attachments.filter(
    (attachment) => !current.some((kept) => kept.id === attachment.id)
  );
  const room = Math.max(0, DEFAULT_MAX_ATTACHMENTS - current.length);
  for (const attachment of missing.slice(room))
    toast.failure(
      `Could not attach ${attachment.name}: attachment limit reached`
    );
  const added = missing.slice(0, room);
  return added.length > 0 ? [...added, ...current] : undefined;
}

/** Text waiting to be sent into this session. */
export function createSessionComposerDraft(
  sessionId: Accessor<string | undefined>,
  initial?: Accessor<string | undefined>
) {
  const startingId = untrack(sessionId);
  const stored = readDraft(startingId);
  const seed = untrack(() => initial?.());
  const [text, setText] = createSignal(stored ?? seed ?? '');
  if (!stored && seed) writeDraft(startingId, seed);
  let currentId = startingId;

  const setDraft = (value: string) => {
    setText(value);
    writeDraft(currentId, value);
  };
  const receive = (message: string) =>
    setDraft(prependMessage(message, untrack(text)));
  let live = true;
  DRAFT_RECEIVERS.add(currentId, receive);
  onCleanup(() => {
    live = false;
    DRAFT_RECEIVERS.remove(currentId, receive);
  });

  createEffect(
    on(
      sessionId,
      (id) => {
        if (id === currentId) return;
        const value = untrack(text);
        if (currentId) writeDraft(currentId, '');
        DRAFT_RECEIVERS.remove(currentId, receive);
        DRAFT_RECEIVERS.add(id, receive);
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

  /**
   * Put a message the agent refused back in front of what is there now, in
   * the session it was sent to: into a composer open on that session (this
   * one, or one opened since), else into that session's saved draft.
   */
  const restore = (sentTo: string | undefined, message: string) => {
    // Sent before the session had an id: only this composer can hold it.
    const target =
      sentTo === undefined
        ? live && receive
        : DRAFT_RECEIVERS.find(sentTo, receive);
    if (target) target(message);
    else if (sentTo)
      writeDraft(sentTo, prependMessage(message, readDraft(sentTo) ?? ''));
  };

  return { draft: text, setDraft, restore };
}

/** An attachment tracker that can give a refused message its files back. */
export type SessionAttachmentTracker = InputAttachmentTracker & {
  restore: (
    sentTo: string | undefined,
    attachments: InputAttachmentData[]
  ) => void;
};

/** Files waiting to be sent into this session. Uploads still in flight are not kept. */
export function createSessionAttachmentTracker(
  sessionId: Accessor<string | undefined>
): SessionAttachmentTracker {
  const startingId = untrack(sessionId);
  const tracker = createInputAttachmentTracker({
    initialAttachments: readAttachments(startingId),
  });
  let currentId = startingId;

  const persist = () => writeAttachments(currentId, tracker.attachments());
  const receive = (attachments: InputAttachmentData[]) => {
    const merged = addMissing(attachments, untrack(tracker.attachments));
    if (!merged) return;
    tracker.setAttachments(merged);
    persist();
  };
  let live = true;
  ATTACHMENT_RECEIVERS.add(currentId, receive);
  onCleanup(() => {
    live = false;
    ATTACHMENT_RECEIVERS.remove(currentId, receive);
  });

  createEffect(
    on(
      sessionId,
      (id) => {
        if (id === currentId) return;
        const current = untrack(tracker.attachments);
        if (currentId) writeAttachments(currentId, []);
        ATTACHMENT_RECEIVERS.remove(currentId, receive);
        ATTACHMENT_RECEIVERS.add(id, receive);
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

  /**
   * Give a refused message's files back to the session it was sent to,
   * beside any attached since, the same way the draft's `restore` does.
   */
  const restore = (
    sentTo: string | undefined,
    attachments: InputAttachmentData[]
  ) => {
    const target =
      sentTo === undefined
        ? live && receive
        : ATTACHMENT_RECEIVERS.find(sentTo, receive);
    if (target) {
      target(attachments);
      return;
    }
    if (!sentTo) return;
    const merged = addMissing(attachments, readAttachments(sentTo));
    if (merged) writeAttachments(sentTo, merged);
  };

  return {
    restore,
    attachments: tracker.attachments,
    hasPending: tracker.hasPending,
    isFull: tracker.isFull,
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
