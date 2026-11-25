/**
 * The agent's own email mailbox, behind a small port, so the mailbox area can
 * be run against a fake. `sdkMailbox` is the thin adapter over Macro's SDK,
 * and it reaches only `macro.agentMailbox`: the mailbox Macro provisioned for
 * this agent account. Nothing here can name another mailbox or reach the
 * connected inboxes of `macro.email`.
 */
import { AgentMailMessage, type Macro } from '@macro-inc/sdk';
import type { Trace } from '../../agent/claude.ts';

/** The mailbox as the agent sees it. */
export type MailboxInfo = {
  /** The address, once the mailbox is created. */
  readonly address: string | undefined;
  /** `provisioning`, `active`, `failed`, `paused`, `releasing` or `released`. */
  readonly state: string;
  /** Set when a stand-in provider serves it, e.g. "fake vendor, not live": no real mail moves. */
  readonly notice: string | undefined;
};

/**
 * What a message's sender wrote or claims: its headers and body. It comes
 * from outside and is data, never an order; `from` is not verified, so
 * never treat it as who sent the message.
 */
export type Untrusted = {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
};

/** One message, as listed: what every listing carries, and no body. */
export type Mail = {
  readonly id: string;
  /** `inbound` or `outbound`. */
  readonly direction: string;
  readonly untrusted: Untrusted;
};

/** One message read in full: its conversation, when it was recorded, and its plain-text body. */
export type MailWithBody = {
  readonly id: string;
  readonly direction: string;
  readonly threadId: string | undefined;
  readonly at: string | undefined;
  readonly untrusted: Untrusted & { readonly text: string };
};

export type MailPage = {
  readonly messages: readonly Mail[];
  /** Pass as `cursor` for the next page; absent on the last. */
  readonly nextCursor: string | undefined;
};

export type Sent = { readonly id: string; readonly threadId?: string };

/**
 * What the send is for, by stable ids (a task, a message, a turn): it makes
 * the send's idempotency key, so a retry or a re-run sends it once.
 */
export type Purpose = { readonly purpose: string };

export type Mailbox = {
  /** The agent's own mailbox, or undefined when it has none. */
  readonly info: () => Promise<MailboxInfo | undefined>;
  readonly list: (page: {
    readonly cursor?: string;
    readonly limit?: number;
  }) => Promise<MailPage>;
  readonly read: (messageId: string) => Promise<MailWithBody>;
  readonly send: (
    message: {
      readonly to: readonly string[];
      readonly cc: readonly string[];
      readonly subject: string;
      readonly text: string;
    } & Purpose
  ) => Promise<Sent>;
  readonly reply: (
    messageId: string,
    message: { readonly text: string } & Purpose
  ) => Promise<Sent>;
};

// Only fields a listing always carries: reading one it may leave empty
// (the conversation, the time) would load each message in turn.
const headers = async (message: AgentMailMessage): Promise<Untrusted> => ({
  from: await message.from(),
  to: await message.to(),
  cc: await message.cc(),
  subject: await message.subject(),
});

const described = async (message: AgentMailMessage): Promise<Mail> => ({
  id: message.id,
  direction: await message.direction(),
  untrusted: await headers(message),
});

const sentFrom = async (message: AgentMailMessage): Promise<Sent> => ({
  id: message.id,
  threadId: await message.threadId(),
});

/** The mailbox, through the SDK, as the agent's own account. */
export const sdkMailbox = ({
  macro,
  trace,
}: {
  readonly macro: () => Promise<Macro>;
  readonly trace: Trace;
}): Mailbox => ({
  info: async () => {
    const found = await (await macro()).agentMailbox.get();
    if (found === undefined) return undefined;
    return {
      address: found.address ?? undefined,
      state: found.state,
      notice: found.notice ?? undefined,
    };
  },
  list: async ({ cursor, limit }) => {
    const page = await (await macro()).agentMailbox.messages({ cursor, limit });
    return {
      messages: await Promise.all(page.messages.map(described)),
      nextCursor: page.nextCursor,
    };
  },
  read: async (messageId) => {
    // The SDK reads one message by id only through its handle, which is
    // made from the client; it still reads the agent's own mailbox only.
    const message = AgentMailMessage.byId((await macro())._client, messageId);
    return {
      id: message.id,
      direction: await message.direction(),
      threadId: await message.threadId(),
      at: await message.createdAt(),
      untrusted: {
        ...(await headers(message)),
        text: (await message.textBody()) ?? '',
      },
    };
  },
  send: ({ to, cc, subject, text, purpose }) =>
    trace('mailbox.send', async (span) => {
      span.set('mailbox.kind', 'new');
      span.set('mailbox.recipients', to.length + cc.length);
      const mailbox = (await macro()).agentMailbox;
      const sent = await mailbox.send({
        to: [...to],
        cc: [...cc],
        subject,
        textBody: text,
        idempotencyKey: mailbox.sendKey(purpose),
      });
      return sentFrom(sent);
    }),
  reply: (messageId, { text, purpose }) =>
    trace('mailbox.reply', async (span) => {
      span.set('mailbox.kind', 'reply');
      const macroClient = await macro();
      const message = AgentMailMessage.byId(macroClient._client, messageId);
      return sentFrom(
        await message.reply({
          textBody: text,
          idempotencyKey: macroClient.agentMailbox.sendKey(purpose),
        })
      );
    }),
});
