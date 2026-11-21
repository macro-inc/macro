import { behavior } from '@macro-inc/muppet/core/behavior';
import { source } from '@macro-inc/muppet/core/event';
import type { ChatContext } from '../../capabilities/chat/context.ts';
import { type Conversation, Entry } from '../../capabilities/chat/entry.ts';

/** One conversation at a time per channel; channels don't wait on each other. */
export async function* conversations({
  waiting,
  history,
}: Pick<ChatContext, 'waiting' | 'history'>): AsyncIterable<Conversation> {
  // Messages that were waiting when the last process ended. One queued just
  // before a stop, and not recorded yet, is recorded now: otherwise its
  // redelivery would be judged and queued again, and answered twice.
  for (const message of await history.waiting()) {
    if (!(await history.recorded(message.channel_id, message.id)))
      await history.record(message.channel_id, Entry.parse(message));
    waiting.push(message.channel_id, message);
  }
  for await (const { key, items } of waiting.stream) {
    const last = items.at(-1);
    if (last !== undefined)
      yield { channelId: key, channel: last.channel, messages: [...items] };
    else waiting.release(key);
  }
}

/**
 * Where chat's events come from: `messages` is every message posted in a
 * channel the agent is in; `conversations` is the messages it decided are for
 * it, batched by conversation; `unanswered` is a conversation a reply run failed
 * to answer.
 */
export const chatSources = (
  context: Pick<ChatContext, 'chat' | 'waiting' | 'history' | 'unanswered'>
) =>
  behavior().source({
    messages: source(context.chat.incoming),
    conversations: source(conversations(context)),
    unanswered: context.unanswered.source,
  });
