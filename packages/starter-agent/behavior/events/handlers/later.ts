import { behavior } from '@macro-inc/muppet/core/behavior';
import { rescueTask, threadOf } from '../../capabilities/chat/prompt.ts';
import type { LaterContext } from '../../capabilities/later/index.ts';
import type { chatSources } from '../sources/chat.ts';

/** What a rescue of an unanswered conversation is named. */
const rescueLabel = 'answer a conversation a reply run left unanswered';

export const laterHandlers = (chat: ReturnType<typeof chatSources>) =>
  behavior<LaterContext>()
    .use(chat)
    // A reply run died before answering: a run of its own answers instead, so nobody is left waiting.
    .on(
      (sources) => sources.unanswered,
      async (conversation, { work }) => {
        const last = conversation.messages.at(-1);
        if (last === undefined) return;
        await work.start({
          task: rescueTask(conversation, 'failed'),
          label: rescueLabel,
          channelId: conversation.channelId,
          root: threadOf(last),
        });
      }
    )
    // Every wake knows what it has already handed itself, so it doesn't hand over the same task twice.
    .on(
      (sources) => sources.hooks.preWake,
      async ({ add }, { work }) => {
        add(`## Tasks you have handed yourself\n\n${await work.inFlight()}`);
      }
    );
