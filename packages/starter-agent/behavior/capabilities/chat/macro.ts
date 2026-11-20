/**
 * The agent in Macro, as its own account, behind a small port, so
 * everything that talks can be run against a fake. `sdkChat` is the thin adapter over
 * Macro's SDK.
 */
import type { Macro } from '@macro-inc/sdk';
import { passthrough, type Trace } from '../../agent/claude.ts';
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
  /**
   * Every message posted in a channel the agent is in, its own included, from
   * when it is first read; after a restart or a dropped stream, also what was
   * posted while it wasn't listening (see {@link StreamCursor}).
   */
  readonly incoming: AsyncIterable<Incoming>;
  /**
   * Says an incoming message is recorded, so a restart from here needn't
   * read it again: until then the stream's cursor stays at or before it.
   */
  readonly handled: (messageId: string) => void;
  /** Resolves once `incoming`'s stream is open and a round trip to Macro worked. */
  readonly listening: () => Promise<void>;
  /** Macro has answered a request (the agent's own id) in this process: it is online. */
  readonly reached: () => boolean;
  /** Resolves once Macro has answered a request. */
  readonly reachable: () => Promise<void>;
};

/**
 * Where the incoming stream left off, kept across restarts: the last event
 * received, which the events service replays after for a short while, and
 * an instant history is read after, since a longer gap isn't replayed: no
 * later than the oldest message received but not yet handled.
 */
export type StreamCursor = { readonly eventId?: string; readonly at: string };

export type CursorStore = {
  /** Undefined when there is none; throws when there is one that can't be used. */
  readonly read: () => Promise<StreamCursor | undefined>;
  readonly write: (cursor: StreamCursor) => Promise<void>;
};

const noCursor: CursorStore = {
  read: async () => undefined,
  write: async () => undefined,
};

const recent = 20;
const directMessage = 'direct_message';
/** How far back a catch-up reads at most: an agent down longer has lost the context anyway. */
const catchUpWindowMs = 24 * 60 * 60_000;
/** Read from this much before the cursor: events minted near it may land after it. */
const catchUpMarginMs = 60_000;
/**
 * How often a catch-up retries a channel that keeps failing with something
 * other than "can't read" before it skips it, so one persistent error can't
 * hold the cursor and every later catch-up for the rest of the process.
 */
const catchUpChannelAttempts = 5;
/** Bounds on one catch-up: channels read, and messages read per channel. */
const catchUpChannels = 50;
const catchUpMessages = 200;
/** A catch-up waits up to this long first, so agents restarted together don't all read at once. */
const catchUpSpreadMs = 5_000;
/**
 * Whether a catch-up skips what failed: only what the agent can't read (it
 * lost access, or it is gone). Anything else, such as a backend still coming
 * back, fails the pass, which is tried again from the same gap.
 */
const unreadable = (error: unknown): boolean =>
  // The SDK's API errors carry the HTTP status (it doesn't export the class).
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  (error.status === 403 || error.status === 404);
/** Ids remembered to drop a message both replayed and caught up. */
const rememberedIds = 1_000;

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
  cursor = noCursor,
  trace = passthrough,
  now = () => new Date(),
  sleep = (ms) => Bun.sleep(ms),
  stream = { dropped: () => {}, opened: () => {} },
}: {
  readonly macro: () => Promise<Macro>;
  /** What the agent's own messages are recorded as from. */
  readonly myName: string;
  /** Where the incoming stream resumes after a restart. */
  readonly cursor?: CursorStore;
  readonly trace?: Trace;
  readonly now?: () => Date;
  /** Waits before a catch-up and between retries. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Told when the events stream drops and when it opens (again). */
  readonly stream?: {
    readonly dropped: () => void;
    readonly opened: () => void;
  };
}): Chat => {
  const listening = Promise.withResolvers<void>();
  // Messages delivered but not handled yet, by id: the earlier of when each
  // was received and posted. The cursor stays at or before the oldest, so a
  // restart reads them again (history drops the ones already recorded).
  const unhandled = new Map<string, number>();
  let lastEventId: string | undefined;
  // The earliest gap a catch-up hasn't finished reading yet: the cursor
  // stays at or before it too, so a restart mid catch-up reads it again.
  let catchUpFloor = (): number => Number.POSITIVE_INFINITY;
  const cursorNow = (): StreamCursor => {
    const oldest = Math.min(
      now().getTime(),
      catchUpFloor(),
      ...unhandled.values()
    );
    const at = new Date(oldest).toISOString();
    return lastEventId === undefined ? { at } : { eventId: lastEventId, at };
  };
  // One write at a time, of the latest cursor: renames finishing out of
  // order can't step it back, and a burst costs a write or two.
  let writing = false;
  let again = false;
  const saveCursor = (): void => {
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    void (async () => {
      try {
        do {
          again = false;
          await cursor.write(cursorNow()).catch(() => undefined);
        } while (again);
      } finally {
        writing = false;
      }
    })();
  };
  let me: Promise<string> | undefined;
  const macroAnswered = Promise.withResolvers<void>();
  let reached = false;
  const myId = () => {
    me ??= connect()
      .then((macro) => macro.users.me())
      .then((user) => {
        reached = true;
        macroAnswered.resolve();
        return user.id;
      })
      .catch((error: unknown) => {
        // Asked again next time: one failure must not stick.
        me = undefined;
        throw error;
      });
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
    handled: (messageId) => {
      if (unhandled.delete(messageId)) saveCursor();
    },
    listening: () => listening.promise,
    reached: () => reached,
    reachable: () => macroAnswered.promise,
    incoming: pushed<Incoming>(async (emit) => {
      const macro = await connect();
      // Before the stream opens, so retried like the round trip: one failed
      // call here would otherwise fail a good boot.
      let mine: string | undefined;
      for (let attempt = 0; mine === undefined; attempt += 1) {
        try {
          mine = await myId();
        } catch {
          await sleep(Math.min(1_000 * 2 ** attempt, 30_000));
        }
      }
      const channelNames = new Map<string, string>();
      const senderNames = new Map<string, string>([[mine, myName]]);
      type Channel = ReturnType<Macro['channels']['byId']>;
      const channelFacts = async (channel: Channel) => {
        const name =
          channelNames.get(channel.id) ??
          (await channel.name().catch(() => channel.id)).trim();
        channelNames.set(channel.id, name);
        const type = await channel.type().catch(() => undefined);
        return { name, dm: type === directMessage };
      };
      const senderName = async (
        sender: string,
        name: () => Promise<string | undefined>
      ) => {
        const known =
          senderNames.get(sender) ??
          (await name().catch(() => undefined)) ??
          nameFromId(sender);
        senderNames.set(sender, known);
        return known;
      };
      // A message the server replays and history also returns reaches the
      // agent once.
      const seen = new Set<string>();
      const deliver = (incoming: Incoming): void => {
        if (seen.has(incoming.entry.id)) return;
        seen.add(incoming.entry.id);
        if (seen.size > rememberedIds) {
          const [oldest] = seen;
          if (oldest !== undefined) seen.delete(oldest);
        }
        // Until it is handled, a restart reads it again.
        unhandled.set(
          incoming.entry.id,
          Math.min(now().getTime(), Date.parse(incoming.entry.at))
        );
        emit(incoming);
      };

      macro.events.on('message.posted', async (event) => {
        if (event.target.type !== 'channel') return;
        const { channel } = event.target;
        const { metadata } = event;
        const facts = await channelFacts(channel);
        const sender = metadata.sender;
        deliver({
          channelId: channel.id,
          channel: facts.name,
          mentions: metadata.mentions.map(({ entity_id }) => entity_id),
          entry: {
            id: metadata.message_id,
            root: metadata.root_id,
            thread: metadata.thread_id ?? null,
            dm: facts.dm,
            from: await senderName(sender, async () => event.sender?.name()),
            sender_id: sender,
            at: metadata.created_at,
            text: metadata.content,
            ...attachmentsOf(metadata.attachments),
          },
        });
      });

      type Posted = ReturnType<Channel['message']>;
      const fromHistory = async (
        channel: Channel,
        message: Posted,
        at: string
      ): Promise<Incoming> => {
        const facts = await channelFacts(channel);
        const author = await message.author();
        // History carries the record: its thread and attachments are read
        // from it, the rest through the handle.
        const record = message.toJSON().detail;
        const thread = record?.thread_id ?? null;
        return {
          channelId: channel.id,
          channel: facts.name,
          mentions: message.mentions.map(({ entity_id }) => entity_id),
          entry: {
            id: message.id,
            root: thread ?? message.id,
            thread,
            dm: facts.dm,
            from: await senderName(author.id, () => author.name()),
            sender_id: author.id,
            at,
            text: await message.content(),
            ...attachmentsOf(record?.attachments ?? []),
          },
        };
      };
      // What was posted after `after` in the channels active since: each
      // root posted or replied to since, and its replies. Bounded, and
      // counted on the span.
      // What earlier attempts at one gap got through, so a retry starts at
      // the channel that failed and gives up on one that keeps failing.
      type Progress = {
        readonly done: Set<string>;
        readonly failures: Map<string, number>;
      };
      const catchUpFrom = (after: string, progress: Progress) =>
        trace('agent.chat.catch_up', async (span) => {
          const since = Date.parse(after);
          let failed = 0;
          let channels = 0;
          let messages = 0;
          let skipped = 0;
          let messagesCapped = 0;
          span.set('chat.catch_up.after', after);
          if (cursorUnreadable) span.set('chat.cursor.unreadable', true);
          // DMs first, then the most recently active: those are what the
          // channel cap keeps.
          const active = await Array.fromAsync(
            macro.channels.activeSince(after)
          );
          const dms = new Set<string>();
          for (const channel of active)
            if ((await channel.type().catch(() => undefined)) === directMessage)
              dms.add(channel.id);
          const ordered = active.toSorted(
            (a, b) => Number(dms.has(b.id)) - Number(dms.has(a.id))
          );
          if (ordered.length > catchUpChannels)
            span.set('chat.catch_up.capped', true);
          for (const channel of ordered.slice(0, catchUpChannels)) {
            if (progress.done.has(channel.id)) continue;
            const failures = progress.failures.get(channel.id) ?? 0;
            if (failures >= catchUpChannelAttempts) {
              failed += 1;
              continue;
            }
            channels += 1;
            const missed: Incoming[] = [];
            let roots = 0;
            // A channel, thread or message the agent can't read is skipped
            // and counted, so it can't stop every later catch-up.
            try {
              // Newest first: a channel busier than the cap keeps its
              // latest messages, and is counted.
              for await (const root of channel.messagesAfter(after, {
                maxItems: catchUpMessages,
              })) {
                roots += 1;
                let replies: readonly Posted[] = [];
                try {
                  replies = await root.thread().replies();
                } catch (error) {
                  if (!unreadable(error)) throw error;
                  skipped += 1;
                }
                for (const message of [root, ...replies]) {
                  if (seen.has(message.id)) continue;
                  // A root deleted in the gap is still listed for its live
                  // replies; the stream would never have delivered it.
                  if (message.toJSON().detail?.deleted_at) continue;
                  try {
                    const at = await message.createdAt();
                    if (Date.parse(at) < since) continue;
                    missed.push(await fromHistory(channel, message, at));
                  } catch (error) {
                    if (!unreadable(error)) throw error;
                    skipped += 1;
                  }
                }
              }
            } catch (error) {
              if (!unreadable(error)) {
                progress.failures.set(channel.id, failures + 1);
                throw error;
              }
              skipped += 1;
            }
            if (roots >= catchUpMessages) messagesCapped += 1;
            missed.sort(
              (a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at)
            );
            messages += missed.length;
            for (const incoming of missed) deliver(incoming);
            progress.done.add(channel.id);
          }
          span.set('chat.catch_up.channels', channels);
          span.set('chat.catch_up.failed', failed);
          span.set('chat.catch_up.messages', messages);
          span.set('chat.catch_up.skipped', skipped);
          span.set('chat.catch_up.messages_capped', messagesCapped);
        });

      // A cursor that can't be used reads the whole window: history drops
      // what was already recorded, and the span says so.
      let cursorUnreadable = false;
      const stored = await cursor.read().catch((): StreamCursor => {
        cursorUnreadable = true;
        return { at: new Date(0).toISOString() };
      });
      // Where a catch-up starts from an instant: a margin before it, but no
      // further back than the window.
      const from = (at: Date): string =>
        new Date(
          Math.max(
            at.getTime() - catchUpMarginMs,
            now().getTime() - catchUpWindowMs
          )
        ).toISOString();
      // The earliest gap not caught up yet, as the instant it starts (the
      // margin is taken only when it is read, so the cursor never steps
      // back by it). It is read once the stream is open, since a message
      // posted between a read and the reopen would reach neither; a drop
      // during a catch-up leaves it set for another pass.
      let pending = stored?.at;
      let lastEvent: Date | undefined;
      let openedAt: Date | undefined;
      // The gap the running pass reads.
      let reading: string | undefined;
      const instant = (at: string | undefined) =>
        at === undefined ? Number.POSITIVE_INFINITY : Date.parse(at);
      catchUpFloor = () => Math.min(instant(pending), instant(reading));
      let open = false;
      let catchingUp = false;
      const catchUp = async (): Promise<void> => {
        if (catchingUp) return;
        catchingUp = true;
        try {
          while (open && pending !== undefined) {
            const after = pending;
            reading = after;
            pending = undefined;
            await sleep(Math.random() * catchUpSpreadMs);
            const progress: Progress = { done: new Set(), failures: new Map() };
            for (let attempt = 0; ; attempt += 1) {
              try {
                await catchUpFrom(from(new Date(after)), progress);
                // Read: what it found is in `unhandled` now.
                reading = undefined;
                saveCursor();
                break;
              } catch {
                // The backend is still coming back: try again.
                await sleep(Math.min(1_000 * 2 ** attempt, 30_000));
              }
            }
          }
        } finally {
          catchingUp = false;
        }
      };
      // Open, and Macro answers: the agent can hear and reply. Tried on
      // every open, and again while open, so one failed call can't fail a
      // good boot.
      let answered = false;
      let asking = false;
      const roundTrip = async (): Promise<void> => {
        if (answered || asking) return;
        asking = true;
        try {
          for (let attempt = 0; open && !answered; attempt += 1) {
            try {
              await macro.users.me();
              reached = true;
              macroAnswered.resolve();
              answered = true;
              listening.resolve();
            } catch {
              await sleep(Math.min(1_000 * 2 ** attempt, 30_000));
            }
          }
        } finally {
          asking = false;
        }
      };
      let opened = false;
      await macro.events.listen({
        resume: { lastEventId: stored?.eventId },
        onEventId: (eventId) => {
          lastEvent = now();
          lastEventId = eventId;
          saveCursor();
        },
        onDrop: (droppedAt) => {
          open = false;
          stream.dropped();
          // From the last event this connection carried, or its open if it
          // carried none: before the open, the previous gap covered it.
          const gap = new Date(
            Math.max(lastEvent?.getTime() ?? 0, openedAt?.getTime() ?? 0) ||
              droppedAt.getTime()
          ).toISOString();
          if (pending === undefined || Date.parse(gap) < Date.parse(pending))
            pending = gap;
        },
        onOpen: (at) => {
          openedAt = at;
          open = true;
          stream.opened();
          if (!opened) {
            opened = true;
            // A first start has no cursor: one now covers a crash from here.
            if (stored === undefined) saveCursor();
          }
          roundTrip().catch(() => undefined);
          catchUp().catch(() => undefined);
        },
      });
    }),
  };
};
