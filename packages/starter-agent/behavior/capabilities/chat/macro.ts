/**
 * The agent in Macro, as its own account, behind a small port, so
 * everything that talks can be run against a fake. `sdkChat` is the thin adapter over
 * Macro's SDK.
 */
import type { Macro } from '@macro-inc/sdk';
import { pushed } from '../../context/stream.ts';
import type { Attachment, Incoming } from './entry.ts';
import type { Probabilities } from './listen.ts';

/** A message as the agent reads it back from Macro. */
export type Line = {
  readonly id: string;
  /** The sender's display name, or their id if they have none. */
  readonly from: string;
  readonly sender_id: string;
  readonly at: string;
  readonly text: string;
};

export type EmailLine = {
  readonly from: string | undefined;
  readonly at: string | undefined;
  readonly subject: string | undefined;
  readonly text: string | undefined;
};

export type Posted = { readonly channelId: string; readonly messageId: string };

export type Chat = {
  /** The agent's own Macro id. */
  readonly me: () => Promise<string>;
  /** The channels the agent is in. */
  readonly channels: () => Promise<
    readonly { readonly id: string; readonly name: string }[]
  >;
  /** Joins a team channel, which the agent must do before posting in it. */
  readonly join: (channelId: string) => Promise<void>;
  readonly leave: (channelId: string) => Promise<void>;
  readonly send: (channelId: string, text: string) => Promise<Posted>;
  /** Posts in the DM with a user, opening it if needed. */
  readonly dm: (userId: string, text: string) => Promise<Posted>;
  /** Replies in the thread of the message `root`. */
  readonly reply: (
    channelId: string,
    root: string,
    text: string
  ) => Promise<Posted>;
  readonly react: (
    channelId: string,
    messageId: string,
    emoji: string,
    on: boolean
  ) => Promise<void>;
  /** The channel's latest messages, oldest first, or one thread: its root, then its replies. */
  readonly context: (
    channelId: string,
    root?: string
  ) => Promise<readonly Line[]>;
  /** The channel's messages since an instant, oldest first. */
  readonly since: (
    channelId: string,
    since: string
  ) => Promise<readonly Line[]>;
  /** An email thread attached to a message. */
  readonly email: (threadId: string) => Promise<readonly EmailLine[]>;
  readonly typing: (
    channelId: string,
    action: 'start' | 'stop',
    root?: string
  ) => Promise<void>;
  /** Asks a cheap model yes/no questions about some data; each answer is the probability of yes. */
  readonly decide: (
    input: unknown,
    questions: Readonly<Record<string, string>>
  ) => Promise<Probabilities>;
  /** Every message posted in a channel the agent is in, its own included, from when it is first read. */
  readonly incoming: AsyncIterable<Incoming>;
};

const recent = 20;
const directMessage = 'direct_message';

/** What a message carries besides its text. Absent when there's nothing. */
export const attachmentsOf = (
  raw: readonly { readonly entity_type: string; readonly entity_id: string }[]
): { readonly attachments?: Attachment[] } =>
  raw.length === 0
    ? {}
    : {
        attachments: raw.map(({ entity_type, entity_id }) => ({
          type: entity_type,
          id: entity_id,
        })),
      };

/** A name for someone with no display name: the front of their id's email. */
export const nameFromId = (id: string): string =>
  id.replace(/^macro\|/, '').replace(/@.*/, '');

export const sdkChat = ({
  macro: connect,
  myName,
}: {
  readonly macro: () => Promise<Macro>;
  /** What the agent's own messages are recorded as from. */
  readonly myName: string;
}): Chat => {
  let me: Promise<string> | undefined;
  const myId = () => {
    me ??= connect()
      .then((macro) => macro.users.me())
      .then((user) => user.id);
    return me;
  };
  type Message = Awaited<
    ReturnType<ReturnType<Macro['channels']['byId']>['send']>
  >;
  const line = async (message: Message): Promise<Line> => {
    const author = await message.author();
    return {
      id: message.id,
      from: (await author.name().catch(() => undefined)) ?? author.id,
      sender_id: author.id,
      at: await message.createdAt(),
      text: await message.content(),
    };
  };
  return {
    me: myId,
    channels: async () => {
      const macro = await connect();
      const found: { readonly id: string; readonly name: string }[] = [];
      for await (const channel of macro.channels.list())
        found.push({
          id: channel.id,
          name: await channel.name().catch(() => channel.id),
        });
      return found;
    },
    join: async (channelId) => {
      const macro = await connect();
      await macro.channels.byId(channelId).join();
    },
    leave: async (channelId) => {
      const macro = await connect();
      await macro.channels.byId(channelId).leave();
    },
    send: async (channelId, text) => {
      const macro = await connect();
      const message = await macro.channels.byId(channelId).send(text);
      return { channelId, messageId: message.id };
    },
    dm: async (userId, text) => {
      const macro = await connect();
      const channel = await macro.channels.dm(macro.users.byId(userId));
      const message = await channel.send(text);
      return { channelId: channel.id, messageId: message.id };
    },
    reply: async (channelId, root, text) => {
      const macro = await connect();
      const message = await macro.channels
        .byId(channelId)
        .message(root)
        .reply(text);
      return { channelId, messageId: message.id };
    },
    react: async (channelId, messageId, emoji, on) => {
      const macro = await connect();
      const message = macro.channels.byId(channelId).message(messageId);
      await (on ? message.react(emoji) : message.unreact(emoji));
    },
    context: async (channelId, root) => {
      const macro = await connect();
      const channel = macro.channels.byId(channelId);
      if (root !== undefined) {
        const message = channel.message(root);
        return Promise.all(
          [message, ...(await message.thread().replies())].map(line)
        );
      }
      const latest: Message[] = [];
      for await (const message of channel.messages({ pageSize: recent })) {
        latest.push(message);
        if (latest.length >= recent) break;
      }
      return Promise.all(latest.reverse().map(line));
    },
    since: async (channelId, since) => {
      const macro = await connect();
      const found: Message[] = [];
      for await (const message of macro.channels
        .byId(channelId)
        .messagesAfter(since))
        found.push(message);
      return Promise.all(found.reverse().map(line));
    },
    email: async (threadId) => {
      const macro = await connect();
      const thread = macro.email.byId(threadId);
      // Reading a field loads the thread's detail, which holds its messages.
      await thread.createdAt();
      return (thread.toJSON().detail?.messages ?? []).map((message) => ({
        from: message.from?.email ?? undefined,
        at: message.sent_at ?? undefined,
        subject: message.subject ?? undefined,
        text: message.body_text ?? undefined,
      }));
    },
    typing: async (channelId, action, root) => {
      const macro = await connect();
      const channel = macro.channels.byId(channelId);
      await channel.typing(
        action,
        root === undefined
          ? undefined
          : { thread: channel.message(root).thread() }
      );
    },
    decide: async (input, questions) => {
      const macro = await connect();
      return (await macro.ai.decide({ input, questions: { ...questions } }))
        .probabilities;
    },
    incoming: pushed<Incoming>(async (emit) => {
      const macro = await connect();
      const mine = await myId();
      const channelNames = new Map<string, string>();
      const senderNames = new Map<string, string>([[mine, myName]]);
      macro.events.on('message.posted', async (event) => {
        if (event.target.type !== 'channel') return;
        const { channel } = event.target;
        const { metadata } = event;
        const channelName =
          channelNames.get(channel.id) ??
          (await channel.name().catch(() => channel.id)).trim();
        channelNames.set(channel.id, channelName);
        const sender = metadata.sender;
        const senderName =
          senderNames.get(sender) ??
          (await event.sender?.name().catch(() => undefined)) ??
          nameFromId(sender);
        senderNames.set(sender, senderName);
        const type = await channel.type().catch(() => undefined);
        emit({
          channelId: channel.id,
          channel: channelName,
          mentions: metadata.mentions.map(({ entity_id }) => entity_id),
          entry: {
            id: metadata.message_id,
            root: metadata.root_id,
            thread: metadata.thread_id ?? null,
            dm: type === directMessage,
            from: senderName,
            sender_id: sender,
            at: metadata.created_at,
            text: metadata.content,
            ...attachmentsOf(metadata.attachments),
          },
        });
      });
      await macro.events.listen();
    }),
  };
};
