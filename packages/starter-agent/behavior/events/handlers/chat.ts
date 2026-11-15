import type { Woke } from '@macro-inc/muppet/core/agent';
import { behavior } from '@macro-inc/muppet/core/behavior';
import { isoText } from '@macro-inc/muppet/utilities/time';
import type { ChatContext } from '../../capabilities/chat/context.ts';
import { judge } from '../../capabilities/chat/listen.ts';
import { replyPrompt, threadOf } from '../../capabilities/chat/prompt.ts';
import type { chatSources } from '../sources/chat.ts';

const listenLog = 'listen';
const replyLog = 'replies';
const handledLog = 'handled';
const screenHistory = 6;
const promptHistory = 20;

export const chatHandlers = (sources: ReturnType<typeof chatSources>) =>
  behavior<ChatContext>()
    .use(sources)
    // The listener: records every message, and queues the ones that are for the agent.
    .on(
      (sources) => sources.messages,
      async (
        incoming,
        { chat, history, waiting, log, relevanceScreen, config }
      ) => {
        const { channelId, channel, entry } = incoming;
        const recent = await history.recent(channelId, screenHistory);
        const verdict = await judge(incoming, {
          me: await chat.me(),
          name: config.identity.name,
          history: recent,
          screen: await relevanceScreen(),
          decide: chat.decide,
          failed: (error) =>
            log.event(listenLog, {
              channel,
              message_id: entry.id,
              decide_error: String(error),
            }),
        });
        await history.record(channelId, entry);
        if (verdict.kind === 'ignored') return;
        await log.event(listenLog, {
          channel,
          message_id: entry.id,
          relevant: verdict.kind === 'relevant',
          p: verdict.p,
        });
        if (verdict.kind !== 'relevant') return;
        const message = {
          channel_id: channelId,
          channel,
          ...entry,
          mentioned: verdict.mentioned,
          p: { ...verdict.p },
        };
        await history.wait(message);
        waiting.push(channelId, message);
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
