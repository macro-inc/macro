import { behavior } from '@macro-inc/muppet/core/behavior';
import { source } from '@macro-inc/muppet/core/event';
import { deepgramKey } from '../../capabilities/calls/config.ts';
import type { CallsContext } from '../../capabilities/calls/context.ts';
import { followCalls, world, worlds } from '../../capabilities/calls/watch.ts';

const watchLog = 'calls';

type Needs = Pick<CallsContext, 'calls' | 'config' | 'clock' | 'log'> & {
  readonly credentials: Pick<CallsContext['credentials'], 'has'>;
};

/**
 * The world of calls, read again every few seconds: Macro's live calls and
 * meetings in channels the agent is in, the channels it always joins, and
 * the calls it was told to leave. Sooner when Macro says a call changed, a
 * join of its exits, or a failed join's retry comes due. Quiet, reading
 * nothing, until calls have their speech key.
 */
const readings = ({
  calls: { watcher },
  config,
  clock,
  log,
  credentials,
}: Needs) => {
  const { api, pulse, next, allowed, hungUp } = watcher;
  let following = false;
  return worlds({
    ready: async () => {
      const ready = await credentials.has(deepgramKey);
      // Macro's call events only matter once a call could be joined.
      if (ready && !following) {
        following = true;
        void followCalls({
          watch: api.watch,
          wake: pulse.wake,
          clock,
          failed: (error) =>
            void log.event(watchLog, { stream_error: String(error) }),
        });
      }
      return ready;
    },
    read: async () =>
      world({ api, me: await api.me(), owner: config.owner, allowed, hungUp }),
    pulse,
    next,
    log: (entry) => void log.event(watchLog, entry),
  });
};

/** Where calls' events come from: `calls` is the world of live calls, every few seconds. */
export const callsSources = (context: Needs) =>
  behavior().source({ calls: source(readings(context)) });
