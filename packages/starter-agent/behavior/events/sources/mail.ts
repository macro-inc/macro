import { behavior } from '@macro-inc/muppet/core/behavior';
import { source } from '@macro-inc/muppet/core/event';
import {
  idleCheckMs,
  longestBackoffMs,
  pollMs,
  streams,
  troubleAfterMinutes,
} from '../../capabilities/mail/config.ts';
import type { MailContext } from '../../capabilities/mail/context.ts';
import { oneLine } from '../../capabilities/mail/redact.ts';
import { type MailEvent, pass } from '../../capabilities/mail/watch.ts';

const errorChars = 200;
const troubleChars = 120;

/**
 * The watcher's loop: a pass over the mailbox every minute, for as long as
 * the agent runs. Until the mail credentials are there it asks Gmail nothing
 * and only looks for them again now and then, so mail set up later starts
 * without a restart. A mailbox that can't be reached is tried again, less
 * and less often, and after a quarter of an hour of that it says so.
 */
async function* arrivals({
  mail,
  clock,
}: Pick<MailContext, 'mail' | 'clock'>): AsyncIterable<MailEvent> {
  const log = (entry: object) => mail.logs.event(streams.mail, entry);
  let failingSince: Temporal.Instant | undefined;
  let wait = pollMs;
  // Undefined until the first check. Each change is logged once, not every check.
  let watching: boolean | undefined;
  for (;;) {
    if (!(await mail.configured().catch(() => false))) {
      if (watching !== false)
        await log({ event: 'idle', why: 'no mail credentials' });
      watching = false;
      await clock.sleep(idleCheckMs);
      continue;
    }
    if (watching !== true) await log({ event: 'watch-start' });
    watching = true;
    try {
      yield* pass(mail.inbox);
      failingSince = undefined;
      wait = pollMs;
    } catch (error) {
      failingSince ??= clock.now();
      wait = Math.min(wait * 2, longestBackoffMs);
      await log({
        event: 'poll-error',
        message: oneLine(String(error), errorChars),
      });
      if (
        clock.now().since(failingSince).total('minutes') > troubleAfterMinutes
      )
        yield {
          kind: 'trouble',
          message: oneLine(String(error), troubleChars),
        };
    }
    await clock.sleep(wait);
  }
}

/**
 * Where mail's events come from: `mail` is each new mail in the agent's own
 * mailbox, found by asking Gmail's history what was added since the last
 * pass. Nothing is asked of Gmail until the source is first read, and never
 * without the mail credentials.
 */
export const mailSources = (context: Pick<MailContext, 'mail' | 'clock'>) =>
  behavior().source({ mail: source(arrivals(context)) });
