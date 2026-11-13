import { behavior } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';

const failuresLog = 'failures';

/**
 * Nothing fails silently: a handler that threw and a wake that failed each
 * leave a line in the failures log, with the event they were about. A
 * handler that throws on every event otherwise looks exactly like a quiet
 * day. This is the handler on `hooks.failed` that lets the agent run at all.
 */
export const failureHandlers = () =>
  behavior<Base>().on(
    (sources) => sources.hooks.failed,
    async (failure, { log }) => {
      switch (failure.kind) {
        case 'handler':
          return log.event(failuresLog, {
            kind: failure.kind,
            event: failure.event.name,
            error: failure.error,
          });
        case 'wake':
          return log.event(failuresLog, {
            kind: failure.kind,
            event: failure.wake.event.name,
            error: failure.error,
          });
      }
    }
  );
