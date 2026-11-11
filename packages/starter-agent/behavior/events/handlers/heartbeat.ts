import type { EventContext } from '@macro-inc/muppet/core/agent';
import { behavior } from '@macro-inc/muppet/core/behavior';
import type { Source } from '@macro-inc/muppet/core/event';
import type { Fired } from '@macro-inc/muppet/utilities/schedules';
import { z } from 'zod';
import { commit, wakeMessage } from '../../capabilities/heartbeat/commit.ts';
import { limits, logs } from '../../capabilities/heartbeat/config.ts';
import {
  beatOf,
  type Needs,
  repositoryOf,
} from '../../capabilities/heartbeat/live.ts';
import {
  actionOf,
  tick,
  watched,
} from '../../capabilities/heartbeat/schedules.ts';
import { beat } from '../../capabilities/heartbeat/tick.ts';

const schedulesSource = 'schedules';
const reason = 'reason';
const Firing = z.object({ name: z.string() });

/**
 * Every change the agent makes to its memory or its code is a commit: after each
 * wake, whatever is in the tree is committed, and pushed if there is a
 * remote. It never throws: a commit that can't happen now is retried by the
 * next one.
 */
const commitAfter = async (
  context: Needs,
  event: EventContext,
  ok: boolean
): Promise<void> => {
  const firing = Firing.safeParse(event.payload);
  const message = wakeMessage({
    source: event.name,
    schedule:
      event.name === schedulesSource && firing.success
        ? firing.data.name
        : undefined,
    tick,
    reason: context.heartbeat.awake.get(reason),
    ok,
  });
  const result = await commit(
    repositoryOf(context),
    message,
    limits.commitLockWait
  ).catch((error: unknown) => `threw: ${String(error)}`);
  if (result !== 'clean' && result !== 'committed' && result !== 'pushed')
    await context.log.event(logs.heartbeat, { commit: message, result });
};

/**
 * What the heartbeat does when a schedule fires, and after every wake. It
 * needs the scheduler's `schedules` source, which the behavior that composes
 * it provides.
 */
export const heartbeatHandlers = (clock: {
  readonly sources: { readonly schedules: Source<Fired> };
}) =>
  behavior<Needs>()
    .source({ schedules: clock.sources.schedules })
    .on(
      (sources) => sources.schedules,
      async (fired, context) => {
        const { heartbeat, log, schedules, chat, config, disk } = context;
        await log.event(logs.schedules, { name: fired.name, due: fired.due });

        if (fired.name === tick) {
          // One tick at a time: a run can outlast the half hour to the next.
          if (heartbeat.awake.has(reason)) {
            await log.event(logs.heartbeat, { woke: false, held: true });
            return;
          }
          // A tick that can't finish is in the log, and the next one tries
          // again.
          const beaten = await beat(beatOf(context, context.wake)).catch(
            async (error: unknown) => {
              await log.event(logs.heartbeat, {
                failed: 'tick',
                error: String(error),
              });
              throw error;
            }
          );
          if (beaten.kind === 'asleep') return;
          // The tick doesn't wait for the agent: other schedules fire while it works.
          heartbeat.awake.set(reason, beaten.reason);
          void beaten.finished.finally(() => heartbeat.awake.delete(reason));
          return;
        }

        // A schedule that says in its data what it does. A send that fails
        // throws, so a watch stays for its next firing.
        const file = watched(fired);
        const action = actionOf(
          fired,
          file === undefined || (await disk.exists(file))
        );
        if (action.kind === 'none') return;
        // What is scheduled is what the schedules say; what happened is in
        // the log. So a watch that has acted, and a one-shot that has
        // fired, leave: neither will ever fire again.
        const once = (await schedules.list()).some(
          ({ name, schedule }) => name === fired.name && 'at' in schedule
        );
        const finish = async (): Promise<void> => {
          if (action.thenRemove || once) await schedules.remove(fired.name);
        };
        if (action.kind === 'dm') {
          await chat.dm(config.owner, action.text);
          await finish();
          return;
        }
        void context
          .wake(action.text)
          .then((woke) => (woke.kind === 'done' ? finish() : undefined))
          .catch(() => undefined);
      }
    )
    .on(
      (sources) => sources.hooks.postReply,
      ({ wake }, context) => commitAfter(context, wake.event, true)
    )
    .on(
      (sources) => sources.hooks.failed,
      async (failure, context) => {
        // A handler that threw changed nothing a wake would have: only a failed wake is committed.
        if (failure.kind === 'wake')
          await commitAfter(context, failure.wake.event, false);
      }
    );
