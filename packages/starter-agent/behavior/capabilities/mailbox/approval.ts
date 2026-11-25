/**
 * How a draft is shown to the owner, and whether a message of theirs approves
 * sending it. The decision is pure: it is given the draft, the draft DM's
 * thread as Macro has it, and who is who, and says send or why not.
 *
 * This check runs in the agent's own code, so it guards against mistakes and
 * against mail or messages that try to talk the agent into a send; it can't
 * hold against code that changes it. The server, today, requires only a
 * non-empty confirmation and its send caps.
 */
import type { Line } from '../chat/macro.ts';
import { expired, type Pending } from './drafts.ts';

/** What the owner replies to send a draft, compared after `normalized`. */
export const approveWords: readonly string[] = [
  'send',
  'send it',
  'approve',
  'approved',
  'yes send',
  'yes send it',
];

/** The reply the draft DM asks for. */
export const approveWord = 'send';

const normalized = (text: string): string =>
  text.toLowerCase().replace(/[.!,]/g, ' ').replace(/\s+/g, ' ').trim();

export const isApproval = (text: string): boolean =>
  approveWords.includes(normalized(text));

/** What a draft says: what its fingerprint covers. */
export type Content = Pick<
  Pending,
  'kind' | 'to' | 'cc' | 'subject' | 'text' | 'replyTo'
>;

/** The text the fingerprint is taken of: every field, unambiguously. */
export const canonical = (content: Content): string =>
  JSON.stringify([
    content.kind,
    content.to,
    content.cc,
    content.subject,
    content.text,
    content.replyTo ?? null,
  ]);

/** How the fingerprint appears in the DM, so a send can find it. */
export const fingerprintLine = (draftId: string, fingerprint: string) =>
  `Draft ${draftId} · ${fingerprint}`;

/** The DM that shows a draft to the owner. */
export const shownText = (
  draft: Content & { readonly id: string },
  fingerprint: string
): string =>
  [
    draft.kind === 'reply'
      ? 'I would like to send this reply from my email address.'
      : 'I would like to send this email from my address.',
    `To send it exactly as it is, reply "${approveWord}" in this thread. To change anything, tell me and I will draft it again; anything you reply here other than "${approveWord}" stops this draft.`,
    '',
    `To: ${draft.to.join(', ')}`,
    ...(draft.cc.length === 0 ? [] : [`Cc: ${draft.cc.join(', ')}`]),
    `Subject: ${draft.subject}`,
    '',
    draft.text,
    '',
    fingerprintLine(draft.id, fingerprint),
  ].join('\n');

export type Refusal =
  | 'owner-changed'
  | 'not-shown'
  | 'expired'
  | 'not-in-thread'
  | 'not-owner'
  | 'not-approval'
  | 'superseded';

export type Decision =
  | { readonly kind: 'send'; readonly approval: string }
  | { readonly kind: 'refused'; readonly why: Refusal };

/** What each refusal tells the agent. */
export const refusalText: Readonly<Record<Refusal, string>> = {
  'owner-changed':
    'this draft was shown to someone who is no longer your owner: draft it again',
  'not-shown':
    "this draft's DM isn't yours or doesn't show this content: draft it again",
  expired: 'this draft is more than a day old: draft it again',
  'not-in-thread':
    "approvalMessageId isn't a reply in the thread of this draft's DM",
  'not-owner': 'only your owner can approve a send',
  'not-approval': `your owner didn't approve it: only a reply of "${approveWord}" does; ask what to change and draft it again`,
  superseded:
    'your owner wrote again in the thread after that message, so it no longer approves the draft; read what they said',
};

/**
 * Whether `approvalMessageId` approves sending `draft`: the latest message
 * of the current owner in the thread of the DM that showed it, saying an
 * approve word, while that DM (posted by the agent, carrying the draft's
 * fingerprint) is less than a day old. The DM names the draft's id, so an
 * approval in its thread can approve no other draft.
 */
export const decide = ({
  draft,
  fingerprint,
  thread,
  owner,
  me,
  now,
  approvalMessageId,
}: {
  readonly draft: Pending;
  /** The fingerprint of the draft's content as it stands now. */
  readonly fingerprint: string;
  /** The draft DM's thread from Macro: its root, then its replies. */
  readonly thread: readonly Line[];
  /** The current owner. */
  readonly owner: string;
  /** The agent's own Macro id. */
  readonly me: string;
  readonly now: Temporal.Instant;
  readonly approvalMessageId: string;
}): Decision => {
  const refused = (why: Refusal): Decision => ({ kind: 'refused', why });
  if (draft.owner !== owner) return refused('owner-changed');
  const [root, ...replies] = thread;
  if (
    root === undefined ||
    root.id !== draft.shown.messageId ||
    root.sender_id !== me ||
    !root.text.includes(fingerprintLine(draft.id, fingerprint))
  )
    return refused('not-shown');
  if (expired(root.at, now)) return refused('expired');
  const approval = replies.find(({ id }) => id === approvalMessageId);
  if (approval === undefined) return refused('not-in-thread');
  if (approval.sender_id !== owner) return refused('not-owner');
  const latest = replies.filter(({ sender_id }) => sender_id === owner).at(-1);
  if (latest?.id !== approval.id) return refused('superseded');
  if (!isApproval(approval.text)) return refused('not-approval');
  return { kind: 'send', approval: approval.text };
};
