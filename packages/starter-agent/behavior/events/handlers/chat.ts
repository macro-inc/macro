import type { Woke } from '@macro-inc/muppet/core/agent';
import { behavior } from '@macro-inc/muppet/core/behavior';
import { isoText } from '@macro-inc/muppet/utilities/time';
import type { ChatContext } from '../../capabilities/chat/context.ts';
import type { Incoming } from '../../capabilities/chat/entry.ts';
import { judge, screenAttributes } from '../../capabilities/chat/listen.ts';
import { replyPrompt, threadOf } from '../../capabilities/chat/prompt.ts';
import type { chatSources } from '../sources/chat.ts';

const listenLog = 'listen';
const screenSpan = 'chat.screen';
const replyLog = 'replies';
const handledLog = 'handled';
const screenHistory = 6;
const promptHistory = 20;

/** What the listener uses of the chat context. */
export type Listening = {
  readonly chat: Pick<ChatContext['chat'], 'me' | 'decide'>;
  readonly history: Pick<
    ChatContext['history'],
    'recorded' | 'recent' | 'record' | 'wait'
  >;
  readonly waiting: Pick<ChatContext['waiting'], 'push'>;
  readonly log: Pick<ChatContext['log'], 'event'>;
  readonly relevanceScreen: ChatContext['relevanceScreen'];
  readonly config: { readonly identity: { readonly name: string } };
  readonly trace: ChatContext['trace'];
};

/** The listener: records every message, and queues the ones that are for the agent. */
export const listen = async (
  incoming: Incoming,
  { chat, history, waiting, log, relevanceScreen, config, trace }: Listening
): Promise<void> => {
  const { channelId, channel, entry } = incoming;
  // A replayed or caught-up message the agent already judged.
  if (await history.recorded(channelId, entry.id)) return;
  // One span per message: how long the screen took and what it decided.
  const verdict = await trace(screenSpan, async (span) => {
    span.set('chat.channel_id', channelId);
    span.set('chat.message_id', entry.id);
    const recent = await history.recent(channelId, screenHistory);
    span.set('chat.screen.history', recent.length);
    const judged = await judge(incoming, {
      me: await chat.me(),
      name: config.identity.name,
      history: recent,
      screen: await relevanceScreen(),
      decide: chat.decide,
      failed: (error) => {
        span.set('chat.screen.retried', true);
        return log.event(listenLog, {
          channel,
          message_id: entry.id,
          decide_error: String(error),
        });
      },
    });
    for (const [key, value] of Object.entries(screenAttributes(judged)))
      span.set(key, value);
    return judged;
  });
  // Recorded, so a restart from here needn't judge it again. A message
  // for the agent is queued first: recorded but not queued, it would
  // never be answered.
  const done = () => history.record(channelId, entry);
  if (verdict.kind === 'ignored') return done();
  await log.event(listenLog, {
    channel,
    message_id: entry.id,
    relevant: verdict.kind === 'relevant',
    p: verdict.p,
  });
  if (verdict.kind !== 'relevant') return done();
  const message = {
    channel_id: channelId,
    channel,
    ...entry,
    mentioned: verdict.mentioned,
    p: { ...verdict.p },
  };
  // Already waiting when a restart restored it from the queue.
  const queued = await history.wait(message);
  await done();
  if (queued) waiting.push(channelId, message);
};

export const chatHandlers = (sources: ReturnType<typeof chatSources>) =>
  behavior<ChatContext>()
    .use(sources)
    // The listener: records every message, and queues the ones that are for the agent.
    .on(
      (sources) => sources.messages,
      async (incoming, context) => {
        // Handled however it ends: one that fails here would otherwise hold
        // the stream's cursor back for the rest of the process. The runner
        // logs the failure.
        try {
          await listen(incoming, context);
        } finally {
          context.chat.handled(incoming.entry.id);
        }
      }
    )
    // The responder: wakes the agent to answer one conversation. It doesn't
    // wait for the run, so a burst in one conversation never holds up another; the
    // conversation's next batch waits until this one is released.
    .on(
      (sources) => sources.conversations,
      async (conversation, context) => {
        const { channelId, messages } = conversation;
        const { typing, history, waiting, answered, unanswered, log, clock } =
          context;
        const last = messages.at(-1);
        if (last === undefined) return waiting.release(channelId);
        const started = clock.now();
        answered.delete(channelId);
        typing.start(channelId, threadOf(last));
        const request = replyPrompt(
          conversation,
          await history.recent(channelId, promptHistory)
        );
        void context
          .wake(request)
          .catch(
            (error: unknown): Woke => ({
              kind: 'failed',
              error: String(error),
            })
          )
          .then(async (woke) => {
            await typing.stop(channelId);
            const first = answered.get(channelId);
            await log.event(replyLog, {
              channel: conversation.channel,
              messages: messages.length,
              result: woke.kind,
              ...(woke.kind === 'failed' ? { error: woke.error } : {}),
              first_reply:
                first === undefined
                  ? 'none'
                  : `${(first.since(started).total('milliseconds') / 1000).toFixed(1)}s`,
            });
            // A run that died before answering must not lose the messages.
            if (woke.kind === 'failed' && first === undefined)
              await unanswered.push(conversation);
            for (const message of messages)
              await log.event(handledLog, {
                ...message,
                handled: isoText(clock.now()),
              });
            await history.answered(
              channelId,
              messages.map(({ id }) => id)
            );
          })
          .finally(() => waiting.release(channelId));
      }
    );
