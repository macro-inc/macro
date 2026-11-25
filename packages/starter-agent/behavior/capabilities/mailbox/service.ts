/**
 * The agent's email, as one object of operations. It holds the mailbox port
 * and the drafts in its closure, so `context.mailbox` can read the mailbox
 * and draft, and its only send runs the approval check. That is all it
 * guarantees: a script still has `context.macro` and the disk, which the
 * no-email guard covers only by text, and the server doesn't yet check the
 * approval itself.
 */
import type { Trace } from '../../agent/claude.ts';
import type { Chat } from '../chat/macro.ts';
import {
  type Content,
  canonical,
  decide,
  looksLikeFingerprintLine,
  refusalText,
  shownText,
} from './approval.ts';
import { type Drafts, isDraftId, type Pending } from './drafts.ts';
import type {
  Mailbox,
  MailboxInfo,
  MailPage,
  MailWithBody,
  Sent,
} from './macro.ts';

/** A draft as shown to the owner: its id, and the DM that shows it. */
export type Shown = {
  readonly draftId: string;
  readonly channelId: string;
  readonly messageId: string;
};

export type NewEmail = {
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly subject: string;
  readonly text: string;
};

export type Approving = {
  readonly draftId: string;
  readonly approvalMessageId: string;
};

export type Email = {
  readonly info: () => Promise<MailboxInfo | undefined>;
  readonly list: (page: {
    readonly cursor?: string;
    readonly limit?: number;
  }) => Promise<MailPage>;
  readonly read: (messageId: string) => Promise<MailWithBody>;
  readonly draft: (email: NewEmail) => Promise<Shown>;
  readonly draftReply: (reply: {
    readonly messageId: string;
    readonly text: string;
  }) => Promise<Shown>;
  readonly send: (
    approving: Approving & { readonly kind: Pending['kind'] }
  ) => Promise<Sent>;
};

/** The provider's own limit on recipients of one message, `to` and `cc` together. */
const mostRecipients = 20;
/** Enough of an address to catch a name or a sentence where one should be; the server checks the rest. */
const address = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
// Line breaks and other control characters would let a subject show the
// owner header lines it doesn't have.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const control = /[\u0000-\u001f\u007f\u2028\u2029]/;

const nonEmpty = (name: string, value: string): string => {
  if (value.trim() === '') throw new Error(`${name}: empty`);
  return value;
};

/** The addresses, checked; an error names the position, never the address. */
const addresses = (name: string, values: readonly string[]): string[] => {
  const bad = values.findIndex((value) => !address.test(value));
  if (bad !== -1)
    throw new Error(`${name}: entry ${bad + 1} is not an email address`);
  return [...values];
};

/** A body, checked: it may not carry a line that reads as a draft's fingerprint. */
const body = (value: string): string => {
  const text = nonEmpty('text', value);
  if (looksLikeFingerprintLine.test(text))
    throw new Error(
      'text: may not contain a "Draft <id> · <fingerprint>" line'
    );
  return text;
};

/** A received message's subject as a reply's: one line, never empty, with Re:. */
const replySubject = (subject: string): string => {
  const line = subject
    .replace(new RegExp(control, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (line === '') return 'Re: (no subject)';
  return /^re:/i.test(line) ? line : `Re: ${line}`;
};

const oneLine = (name: string, value: string): string => {
  const trimmed = nonEmpty(name, value).trim();
  if (control.test(trimmed))
    throw new Error(`${name}: must be one line, without control characters`);
  return trimmed;
};

export const email = ({
  mailbox,
  drafts,
  chat,
  owner,
  now,
  hash,
  trace,
}: {
  readonly mailbox: Mailbox;
  readonly drafts: Drafts;
  readonly chat: Pick<Chat, 'me' | 'dm' | 'context'>;
  /** The current owner, who approves sends. */
  readonly owner: () => string;
  readonly now: () => Temporal.Instant;
  /** SHA-256, as lowercase hex. */
  readonly hash: (text: string) => string;
  readonly trace: Trace;
}): Email => {
  const fingerprint = (content: Content): string => hash(canonical(content));

  /**
   * The send's key, made from the approval: a retry, or the same approval
   * presented again, carries the same key, and the server sends a key once.
   */
  const keyOf = (approval: string): string => {
    const hex = hash(`agent-mailbox-approval:${approval}`);
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      `8${hex.slice(13, 16)}`,
      `${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
      hex.slice(20, 32),
    ].join('-');
  };

  const show = (content: Content): Promise<Shown> =>
    trace('mailbox.draft', async (span) => {
      span.set('mailbox.kind', content.kind);
      span.set('mailbox.recipients', content.to.length + content.cc.length);
      await drafts.prune();
      const id = drafts.id();
      const at = now().toString();
      const to = owner();
      const posted = await chat.dm(
        to,
        shownText({ ...content, id }, fingerprint(content))
      );
      await drafts.write({
        state: 'pending',
        ...content,
        id,
        owner: to,
        shown: posted,
        at,
      });
      span.set('mailbox.draft_id', id);
      return { draftId: id, ...posted };
    });

  return {
    info: () => mailbox.info(),
    list: (page) => mailbox.list(page),
    read: (messageId) => mailbox.read(nonEmpty('messageId', messageId)),
    draft: ({ to, cc, subject, text }) => {
      const recipients = addresses('to', to);
      const copied = addresses('cc', cc ?? []);
      if (recipients.length === 0) throw new Error('to: no recipients');
      if (recipients.length + copied.length > mostRecipients)
        throw new Error(`to and cc: at most ${mostRecipients} recipients`);
      return show({
        kind: 'new',
        to: recipients,
        cc: copied,
        subject: oneLine('subject', subject),
        text: body(text),
      });
    },
    draftReply: async ({ messageId, text }) => {
      const original = await mailbox.read(nonEmpty('messageId', messageId));
      // A reply to the mailbox's own sent message goes to everyone that
      // message went to, not to the address it shows as sender: draft a
      // new email to them instead, so the owner sees whom it goes to.
      if (original.direction !== 'inbound')
        throw new Error(
          'messageId: that is a message you sent; draft a new email to its recipients instead of a reply'
        );
      return show({
        kind: 'reply',
        to: [original.untrusted.from],
        cc: [],
        // The provider sets the reply's real subject; this is what it is
        // expected to be.
        subject: replySubject(original.untrusted.subject),
        text: body(text),
        replyTo: original.id,
      });
    },
    send: ({ draftId, approvalMessageId, kind }) =>
      trace('mailbox.approve', async (span) => {
        span.set('mailbox.kind', kind);
        if (!isDraftId(draftId)) throw new Error('draftId: not a draft id');
        span.set('mailbox.draft_id', draftId);
        const draft = await drafts.read(draftId);
        if (draft === undefined)
          throw new Error(`draftId: no draft ${draftId}; draft it again`);
        if (draft.kind !== kind)
          throw new Error(
            draft.kind === 'reply'
              ? `draft ${draftId} is a reply: send it with replyToMyEmail`
              : `draft ${draftId} is a new email: send it with sendMyEmail`
          );
        if (draft.state === 'sent') {
          span.set('mailbox.outcome', 'already_sent');
          return draft.sent;
        }
        const decision = decide({
          draft,
          fingerprint: fingerprint(draft),
          thread: await chat.context(
            draft.shown.channelId,
            draft.shown.messageId
          ),
          owner: owner(),
          me: await chat.me(),
          now: now(),
          approvalMessageId,
        });
        if (decision.kind === 'refused') {
          span.set('mailbox.outcome', decision.why);
          throw new Error(refusalText[decision.why]);
        }
        span.set('mailbox.recipients', draft.to.length + draft.cc.length);
        const approved = {
          approval: decision.approval,
          key: keyOf(approvalMessageId),
        };
        const sent =
          draft.replyTo === undefined
            ? await mailbox.send({
                to: draft.to,
                cc: draft.cc,
                subject: draft.subject,
                text: draft.text,
                ...approved,
              })
            : await mailbox.reply(draft.replyTo, {
                text: draft.text,
                ...approved,
              });
        // What was said is no longer kept: only what went out.
        await drafts.write({
          state: 'sent',
          id: draft.id,
          kind: draft.kind,
          sent,
          at: draft.at,
        });
        span.set('mailbox.outcome', 'sent');
        await drafts.prune();
        return sent;
      }),
  };
};
