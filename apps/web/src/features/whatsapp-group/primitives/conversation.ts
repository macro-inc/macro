import { sleep } from '@core/util/sleep';
import { Telemetry } from '@macro-inc/observability';
import { err, ok, type Result } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { v5 as uuidv5 } from 'uuid';
import type { WhatsAppGroupCapabilities } from '../context/whatsapp-group-context';
import { attachmentProblem } from '../core/attachments';
import { markdownToWhatsApp } from '../core/formatting';
import {
  canChangeMessage,
  composerNote,
  type GroupMessage,
  type GroupSend,
  recordedOutcome,
  type SendFailure,
} from '../core/group';
import { composerMentions, mentionToken } from '../core/mentions';

/** What the composer hands over: its Markdown and the files it staged. */
export type Draft = {
  markdown: string;
  attachments: { id: string; name: string }[];
};

/** The message a reply quotes or an edit replaces. */
export type ConversationTarget =
  | { kind: 'reply'; message: GroupMessage }
  | { kind: 'edit'; message: GroupMessage };

/** One WhatsApp message of a send; a draft with files sends one per file. */
type PendingPart = {
  /** Idempotency key, and the pending row's id. */
  key: string;
  draft: Draft;
  target: ConversationTarget | undefined;
  sendId?: string;
  row: GroupMessage;
};

/** Quiet retries of an unknown outcome, reusing its idempotency key. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];

const UNKNOWN_SEND =
  "Couldn't reach WhatsApp. Check your connection and try again.";

export type ConversationHost = {
  /** Tells the person why a write did not go through. */
  notify: (message: string) => void;
  /** Puts a draft that was not sent back in the composer. */
  restore: (draft: Draft, target: ConversationTarget | undefined) => void;
  retryDelays?: number[];
};

/**
 * Sends appear at once and are replaced by the stored message; refusals and
 * failures remove them and restore the draft. A draft keeps one idempotency
 * key until it is recorded, so a retry after an unknown outcome can never
 * arrive twice.
 */
export function createConversation(
  source: WhatsAppGroupCapabilities,
  userId: Accessor<string | undefined>,
  host: ConversationHost
) {
  const retryDelays = host.retryDelays ?? RETRY_DELAYS_MS;
  const [target, setTarget] = createSignal<ConversationTarget>();
  const [pending, setPending] = createSignal<PendingPart[]>([]);
  const [initialRead, setInitialRead] = createSignal<string>();
  const [initialUnreadCount, setInitialUnreadCount] = createSignal(0);
  const [readCaptured, setReadCaptured] = createSignal(false);
  const draftKeys = new Map<string, string>();
  const audioUploads = new Set<string>();
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

  const sendIds = createMemo(
    () => pending().flatMap((part) => (part.sendId ? [part.sendId] : [])),
    [],
    { equals: (a, b) => a.join() === b.join() }
  );
  const delivery = source.delivery(sendIds);
  const progressBySend = createMemo(
    () => new Map((delivery.data ?? []).map((send) => [send.id, send]))
  );
  const storedIds = createMemo(
    () => new Set((source.timeline.data ?? []).map((message) => message.id))
  );
  /** Accepted sends whose stored message has arrived replace their row. */
  const arrived = (part: PendingPart) => {
    const progress = part.sendId && progressBySend().get(part.sendId);
    return (
      !!progress &&
      recordedOutcome(progress) === 'accepted' &&
      (!progress.messageId || storedIds().has(progress.messageId))
    );
  };
  const rows = () => [
    ...(source.timeline.data ?? []),
    ...pending()
      .filter((part) => !arrived(part))
      .map((part) => part.row),
  ];

  const drop = (keys: string[]) =>
    setPending((parts) => parts.filter((part) => !keys.includes(part.key)));

  // Outcomes after DSS recorded a send arrive with its progress.
  createEffect(
    on(
      () => [progressBySend(), storedIds()] as const,
      ([progress]) => {
        for (const part of pending()) {
          const send = part.sendId && progress.get(part.sendId);
          if (!send) continue;
          const outcome = recordedOutcome(send);
          if (outcome === 'waiting') continue;
          if (outcome === 'accepted') {
            if (arrived(part)) drop([part.key]);
            else source.timeline.refetch();
            continue;
          }
          drop([part.key]);
          host.notify(outcome.failed);
          // A failed send may be retried as a new one; an unknown one keeps
          // its key so resending the restored draft cannot duplicate it.
          if (send.state === 'failed')
            draftKeys.delete(fingerprint(part.draft, part.target));
          if (!disposed) host.restore(part.draft, part.target);
        }
      }
    )
  );

  /** One write, retried quietly while its outcome is unknown. */
  const write = async (
    request: GroupSend,
    key: string
  ): Promise<Result<{ sendId: string }, SendFailure>> => {
    for (let attempt = 0; ; attempt++) {
      const result = await source.send(request, key);
      if (result.isOk()) return ok({ sendId: result.value.id });
      const delay = retryDelays[attempt];
      if (result.error.kind === 'refused' || delay === undefined)
        return err(result.error);
      await sleep(delay);
    }
  };

  const deliver = (
    parts: { request: GroupSend; key: string }[],
    draft: Draft,
    sentTarget: ConversationTarget | undefined,
    draftFingerprint: string
  ) =>
    Telemetry.span('whatsapp.group.send', async (span) => {
      span.setAttr('whatsapp.send.parts', parts.length);
      let recorded = 0;
      for (const [index, part] of parts.entries()) {
        const result = await write(part.request, part.key);
        if (result.isOk()) {
          recorded++;
          setPending((current) =>
            current.map((item) =>
              item.key === part.key
                ? { ...item, sendId: result.value.sendId }
                : item
            )
          );
          continue;
        }
        drop(parts.slice(index).map((item) => item.key));
        span.setAttr('whatsapp.outcome', result.error.kind);
        if (result.error.kind === 'refused') draftKeys.delete(draftFingerprint);
        host.notify(
          result.error.kind === 'refused' ? result.error.reason : UNKNOWN_SEND
        );
        // Once part of a draft went out, restoring all of it would resend that part.
        if (recorded === 0 && !disposed) host.restore(draft, sentTarget);
        return;
      }
      draftKeys.delete(draftFingerprint);
      span.setAttr('whatsapp.outcome', 'recorded');
    });

  /** Splits a draft into WhatsApp messages; a caption rides on the first non-audio file. */
  const partsOf = (
    draft: Draft,
    text: string,
    mentions: string[],
    sentTarget: ConversationTarget | undefined
  ): GroupSend[] => {
    if (sentTarget?.kind === 'edit')
      return [{ kind: 'edit', messageId: sentTarget.message.id, text }];
    const replyTo =
      sentTarget?.kind === 'reply' ? sentTarget.message.id : undefined;
    if (draft.attachments.length === 0)
      return [{ kind: 'text', text, replyTo, mentions }];
    // WhatsApp mentions ride on text only, so a mentioning text follows the
    // files instead of captioning them.
    const captioned =
      mentions.length > 0
        ? undefined
        : draft.attachments.find((file) => !audioUploads.has(file.id));
    const media = draft.attachments.map(
      (file, index): GroupSend => ({
        kind: 'media',
        uploadId: file.id,
        caption: file === captioned && text ? text : undefined,
        replyTo: index === 0 ? replyTo : undefined,
      })
    );
    // WhatsApp refuses captions on audio, so the text follows on its own.
    return text && !captioned
      ? [...media, { kind: 'text', text, mentions }]
      : media;
  };

  /**
   * Sends a draft, or says why it can't go (the composer keeps it). The
   * returned delivery reports its outcome through `host`, never by rejecting.
   */
  const submit = (draft: Draft): Result<Promise<void>, string> => {
    const group = source.group.data;
    const senderId = userId();
    if (!group || !senderId) return err('This group is still loading.');
    if (!group.canSend) return err(composerNote(group));
    const mentioned = composerMentions(
      draft.markdown,
      group.members.map((member) => member.id)
    );
    const text = markdownToWhatsApp(mentioned.markdown);
    const sentTarget = target();
    if (new TextEncoder().encode(text).length > group.limits.textBytes)
      return err('This message is too long for WhatsApp.');
    if (sentTarget?.kind === 'edit') {
      if (draft.attachments.length > 0)
        return err("Files can't be added while editing a message.");
      if (!text) return err('Write the edited message, or delete it instead.');
      if (
        !canChangeMessage(
          sentTarget.message,
          senderId,
          group,
          Date.now(),
          'edit'
        )
      )
        return err('This message can no longer be edited.');
    }
    const requests = partsOf(draft, text, mentioned.mentions, sentTarget);
    const names = new Map(
      group.members.map((member) => [member.id, member.name])
    );
    if (requests.length === 0) return err('Write a message first.');
    const draftFingerprint = fingerprint(draft, sentTarget);
    const key = draftKeys.get(draftFingerprint) ?? crypto.randomUUID();
    draftKeys.set(draftFingerprint, key);
    const parts = requests.map((request, index) => ({
      request,
      key: requests.length === 1 ? key : uuidv5(String(index), key),
    }));
    const sentAt = new Date().toISOString();
    setPending((current) => [
      ...current,
      ...parts.flatMap(({ request, key: partKey }): PendingPart[] =>
        request.kind === 'text' || request.kind === 'media'
          ? [
              {
                key: partKey,
                draft,
                target: sentTarget,
                row: {
                  id: partKey,
                  kind: 'message',
                  sender: { name: '', userId: senderId },
                  mentions:
                    request.kind === 'text'
                      ? (request.mentions ?? []).map((jid) => ({
                          token: mentionToken(jid),
                          name: names.get(jid) ?? `+${mentionToken(jid)}`,
                        }))
                      : [],
                  forwarded: false,
                  body:
                    request.kind === 'text'
                      ? request.text
                      : (request.caption ?? ''),
                  sentAt,
                  edited: false,
                  deleted: false,
                  replyTo: request.replyTo,
                  reactions: [],
                  attachments:
                    request.kind === 'media'
                      ? draft.attachments
                          .filter((file) => file.id === request.uploadId)
                          .map((file, ordinal) => ({
                            ordinal,
                            state: 'loading' as const,
                            fileName: file.name,
                            mime: '',
                            documentId: undefined,
                          }))
                      : [],
                  pending: true,
                },
              },
            ]
          : []
      ),
    ]);
    setTarget(undefined);
    return ok(deliver(parts, draft, sentTarget, draftFingerprint));
  };

  /** Reactions and deletes: no draft to restore, just the reason. */
  const change = async (request: GroupSend) => {
    const result = await Telemetry.span('whatsapp.group.change', (span) => {
      span.setAttr('whatsapp.send.kind', request.kind);
      return write(request, crypto.randomUUID());
    });
    if (result.isErr())
      host.notify(
        result.error.kind === 'refused'
          ? result.error.reason
          : "Couldn't reach WhatsApp. Try again."
      );
  };

  const markRead = async () => {
    const id = source.timeline.data?.at(-1)?.id;
    if (!id || id === marked || document.visibilityState === 'hidden') return;
    await source.markRead(id);
    if (!disposed) marked = id;
  };

  return {
    rows,
    target,
    initialRead,
    initialUnreadCount,
    markRead,
    submit,
    reply: (message: GroupMessage) => setTarget({ kind: 'reply', message }),
    edit: (message: GroupMessage) => setTarget({ kind: 'edit', message }),
    cancelTarget: () => setTarget(undefined),
    /** Toggles the viewer's one WhatsApp reaction on a message. */
    react: (message: GroupMessage, emoji: string) => {
      const mine = message.reactions.find((reaction) => reaction.mine);
      return change({
        kind: 'reaction',
        messageId: message.id,
        emoji: mine?.emoji === emoji ? '' : emoji,
      });
    },
    remove: (messageId: string) => change({ kind: 'delete', messageId }),
    /** Stages one file for a later send, or says why it can't go. */
    upload: async (
      file: File
    ): Promise<Result<{ uploadId: string }, string>> => {
      const group = source.group.data;
      if (!group?.canSend)
        return err(
          group ? composerNote(group) : 'This group is still loading.'
        );
      const problem = attachmentProblem(file, group.limits);
      if (problem) return err(problem);
      const result = await source.upload(file);
      if (result.isErr())
        return err(
          result.error.kind === 'refused'
            ? result.error.reason
            : `Couldn't upload ${file.name}. Try again.`
        );
      if (result.value.audio) audioUploads.add(result.value.uploadId);
      return ok({ uploadId: result.value.uploadId });
    },
  };
}

function fingerprint(draft: Draft, target: ConversationTarget | undefined) {
  return JSON.stringify([
    draft.markdown,
    draft.attachments.map((file) => file.id),
    target?.kind,
    target?.message.id,
  ]);
}
