import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import type { ExternalChatReplyBlock } from '@service-storage/generated/schemas/externalChatReplyBlock';
import { match, P } from 'ts-pattern';
import { chatProvider } from '../providers';
import type { InboundAttachment } from './attachments';
import { disappearingLabel, type Mention, type RichContent } from './rich';

/** Feature vocabulary; transport decoding lives in queries/. */
export type ChatSummary = {
  id: string;
  /** The service the chat lives in. */
  provider: ExternalChatProvider;
  /** A group, or a one-to-one chat (named after the other person). */
  kind: 'group' | 'direct';
  name: string;
  /** The Macro user who added it; only they share it on. */
  ownerId: string;
  unreadCount: number;
  /** False for viewers who can only read. */
  canSend: boolean;
  /** Why the viewer can't send, when they can't. */
  sendReason?: ExternalChatReplyBlock;
  /** Importing earlier messages from the owner's phone. */
  backfill?: ChatBackfill;
  /** The provider community the group belongs to. */
  community?: { id: string; name: string; announcements: boolean };
};
/**
 * Importing the chat's earlier messages from the owner's phone after it was
 * added. Absent for groups added before imports existed.
 */
export type ChatBackfill = {
  /** `waiting_for_message`: nobody has posted since adding; nothing to import from yet. */
  state:
    | 'waiting_for_message'
    | 'pending'
    | 'running'
    | 'waiting_for_phone'
    | 'done'
    | 'partial';
  /** Messages the phone sent, including ones already shown. */
  imported: number;
};
export type ChatDetail = {
  id: string;
  provider: ExternalChatProvider;
  /** A group, or a one-to-one chat: `name` is the person, no roster. */
  kind: 'group' | 'direct';
  name: string;
  ownerId: string;
  accessLevel: 'view' | 'comment' | 'edit' | 'owner';
  canSend: boolean;
  sendReason?: ExternalChatReplyBlock;
  phone?: string;
  lastReadMessageId?: string;
  unreadCount: number;
  members: { id: string; name: string; admin: boolean }[];
  backfill?: ChatBackfill;
  /** The provider's timer while disappearing messages are on; Macro keeps all. */
  disappearingSeconds?: number;
  /** The provider community the group belongs to. */
  community?: { name: string; announcements: boolean };
  limits: {
    textBytes: number;
    attachmentBytes: number;
    attachmentTypes: string[];
    editSeconds: number;
    mutations: ('reaction' | 'edit' | 'delete')[];
  };
};
export type ChatMessage = {
  id: string;
  /** `system`: a group event (`rich.type === 'system'`), drawn as a line. */
  kind: 'message' | 'system';
  sender: { name: string; userId?: string };
  body: string;
  /** People `@<token>` in the body stands for. */
  mentions: Mention[];
  /** WhatsApp marked it forwarded. */
  forwarded: boolean;
  /** A poll, location, contact card, event or system line. */
  rich?: RichContent;
  sentAt: string;
  edited: boolean;
  deleted: boolean;
  replyTo?: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
  attachments: InboundAttachment[];
  /** Sent from this page and not yet in WhatsApp; never openable. */
  pending?: boolean;
};
export type MessagePage = { messages: ChatMessage[]; before?: string };
export type ChatSend =
  /** `mentions`: participant ids; the text names each as `@<digits>`. */
  | { kind: 'text'; text: string; replyTo?: string; mentions?: string[] }
  | { kind: 'media'; uploadId: string; caption?: string; replyTo?: string }
  | { kind: 'reaction'; messageId: string; emoji: string }
  | { kind: 'edit'; messageId: string; text: string }
  | { kind: 'delete'; messageId: string };

/** A recorded send, as DSS reports its progress. */
export type SendProgress = {
  id: string;
  state: 'pending' | 'sending' | 'unknown' | 'accepted' | 'failed';
  messageId?: string;
  errorCode?: string;
};

/**
 * Why a write did not go through. `refused` was never recorded, so the same
 * draft can be sent again; `unknown` may have been recorded, so a retry reuses
 * its idempotency key.
 */
export type SendFailure =
  | { kind: 'refused'; reason: string }
  | { kind: 'unknown' };

/** Both identity and the current backend limit are required for message changes. */
export function canChangeMessage(
  message: ChatMessage,
  userId: string | undefined,
  group: ChatDetail,
  now: number,
  operation: 'edit' | 'delete'
): boolean {
  const age = now - Date.parse(message.sentAt);
  return (
    !!userId &&
    group.canSend &&
    !message.pending &&
    group.limits.mutations.includes(operation) &&
    !message.deleted &&
    message.sender.userId === userId &&
    age >= 0 &&
    age < group.limits.editSeconds * 1000
  );
}

export function composerNote(
  chat: ChatDetail,
  /** Who owns the chat, for "Only Ana can reply in this chat". */
  ownerName = 'its owner'
): string {
  const { label } = chatProvider(chat.provider);
  if (chat.canSend)
    return chat.phone
      ? `Sending as ${chat.phone}`
      : `Sending from your ${label}`;
  return match(chat.sendReason)
    .with(
      P.union('no_account', 'disconnected'),
      () => `Connect your ${label} to reply`
    )
    .with('not_added', () =>
      chat.kind === 'direct'
        ? `Only ${ownerName} can reply in this chat`
        : `Your ${label} isn't in this chat`
    )
    .with('not_allowed', () => `Your ${label} can't post in this chat`)
    .with('unavailable', () => 'This chat is no longer syncing')
    .with(undefined, () => `Sending to ${label} is unavailable right now`)
    .exhaustive();
}

/** "Message Test 11 as +1…": the composer says who is sending. */
export function composerPlaceholder(group: ChatDetail): string {
  return group.phone
    ? `Message ${group.name} as ${group.phone}`
    : `Message ${group.name}`;
}

/** A send's outcome after DSS recorded it. */
export function recordedOutcome(
  progress: SendProgress,
  /** The provider's name: "WhatsApp didn't accept this message." */
  label: string
): 'waiting' | 'accepted' | { failed: string } {
  return match(progress.state)
    .with(P.union('pending', 'sending'), () => 'waiting' as const)
    .with('accepted', () => 'accepted' as const)
    .with(P.union('failed', 'unknown'), () => ({
      failed: deliveryFailure(progress, label),
    }))
    .exhaustive();
}

/** Known delivery failures in plain words; never a provider response. */
function deliveryFailure(progress: SendProgress, label: string): string {
  // DSS never resends an unknown outcome; resending the restored draft reuses
  // its key, so it cannot arrive twice.
  if (progress.state === 'unknown')
    return `${label} didn't confirm this message.`;
  return match(progress.errorCode ?? '')
    .with(
      'send_expired',
      () => `${label} wasn't reachable for 10 minutes, so this wasn't sent.`
    )
    .with(
      'chat_detached',
      () => 'This chat stopped syncing before the message was sent.'
    )
    .with(
      'target_unavailable',
      () => `The message you replied to or changed is no longer in ${label}.`
    )
    .with(
      'disconnected',
      () => `Your ${label} disconnected before this was sent.`
    )
    .with(
      'recipient_not_on_provider',
      () => `This person isn't on ${label}, so this wasn't sent.`
    )
    .with(
      'rate_limited',
      () =>
        `${label} is limiting messages right now. Try again in a few minutes.`
    )
    .otherwise(() => `${label} didn't accept this message.`);
}

/** While history is still coming from the owner's phone; quiet once it settled. */
export function backfillStatus(
  backfill: ChatBackfill | undefined,
  /** The import runs on the owner's phone; others are told whose. */
  viewerOwns: boolean
): string | undefined {
  if (!backfill) return undefined;
  return match(backfill.state)
    .with(P.union('pending', 'running'), () => 'Importing history…')
    .with('waiting_for_phone', () =>
      viewerOwns
        ? 'Earlier messages not imported. Open WhatsApp on your phone, then import them.'
        : "Earlier messages wait for the owner's phone"
    )
    .with(P.union('waiting_for_message', 'done', 'partial'), () => undefined)
    .exhaustive();
}

/** "Launch · Design", or "Launch · Announcements" for its announcement group. */
export function chatTitle(group: ChatDetail): string {
  if (!group.community) return group.name;
  return `${group.community.name} · ${group.community.announcements ? 'Announcements' : group.name}`;
}

/** The provider deletes this chat's messages after a while; Macro doesn't. */
export function disappearingNote(chat: ChatDetail): string | undefined {
  if (!chat.disappearingSeconds) return undefined;
  const { label } = chatProvider(chat.provider);
  const timer = disappearingLabel(String(chat.disappearingSeconds));
  return timer
    ? `Disappearing messages are on in ${label} (${timer}). Macro keeps them.`
    : `Disappearing messages are on in ${label}. Macro keeps them.`;
}

/** Shown above the oldest message once the import stopped at its limit. */
export function historyStartNote(chat: ChatDetail): string | undefined {
  return chat.backfill?.state === 'partial'
    ? `Earlier messages stay in ${chatProvider(chat.provider).label}`
    : undefined;
}
