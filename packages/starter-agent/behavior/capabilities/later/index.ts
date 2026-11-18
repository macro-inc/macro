/**
 * Later: work that shouldn't happen in the run that noticed it. A reply run
 * and a call only talk, so anything longer is handed here, and the agent is
 * woken for it on its own, with time to do it, and reports back where it was
 * asked. A task is a one-off schedule whose data says to wake the agent, so
 * it survives a restart and can be handed over from any process.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { isoText } from '@macro-inc/muppet/utilities/time';
import type { Work, WorkRequest } from '../../contracts.ts';

/** What every task's schedule is named with, so they can be told from other schedules. */
export const prefix = 'later-';

export type LaterContext = {
  readonly work: Work;
};

type Needs = {
  readonly schedules: Pick<Schedules, 'set' | 'list'>;
  readonly clock: Clock;
  /** A name no task has had before. */
  readonly id: () => string;
};

/** What the agent is asked when a task's turn comes. It must stand alone: the run that handed it over is gone. */
export const request = ({ task, channelId, root }: WorkRequest): string =>
  [
    'You handed yourself this task earlier, to do in a run of its own. Do it now.',
    task,
    channelId === undefined
      ? 'Nobody is waiting on a reply: leave what you found in your notes.'
      : `When it is done, or if it can't be, say so in the conversation that asked: channel ${channelId}${root === undefined ? '' : `, in the thread of message ${root}`}.`,
  ].join('\n\n');

/** Tasks as one-off schedules that wake the agent. */
export const later = ({ schedules, clock, id }: Needs): Work => ({
  start: async (asked) => {
    const name = `${prefix}${id()}`;
    const set = await schedules.set(name, {
      at: isoText(clock.now()),
      why: asked.label,
      data: { wake: request(asked) },
    });
    if (set.kind === 'invalid') throw new Error(set.error);
    return { id: name };
  },
  inFlight: async () => {
    const waiting = (await schedules.list()).filter(({ name }) =>
      name.startsWith(prefix)
    );
    return waiting.length === 0
      ? 'None.'
      : waiting
          .map(({ name, schedule }) => `- ${name}: ${schedule.why ?? ''}`)
          .join('\n');
  },
});

/**
 * Hands yourself a task to do in a run of its own, and returns its id at
 * once.
 *
 * Use it for anything longer than a lookup: a reply run or a call only
 * talks, and is ended after a few minutes. `task` must stand alone (what was
 * asked, by whom, the facts you found, what done looks like), because the
 * run that does it won't remember this one. `label` is a few words naming
 * it. With `channelId`, and `root` for a thread, the run reports back there.
 */
export const doLater = async (
  { work }: LaterContext,
  asked: {
    readonly task: string;
    readonly label: string;
    readonly channelId?: string;
    readonly root?: string;
  }
): Promise<{ readonly id: string }> => {
  if (asked.task.trim() === '') throw new Error('task: empty');
  if (asked.label.trim() === '') throw new Error('label: empty');
  const { id } = await work.start(asked);
  return { id };
};

/** The tasks you have handed yourself that haven't started yet, as text. */
export const listLater = ({ work }: LaterContext): Promise<string> =>
  work.inFlight();

export const laterModule = module({
  name: 'later',
  summary:
    'Hand yourself a task to do in a run of its own, so talking and working never share a run.',
  file: import.meta.path,
  functions: { doLater, listLater },
});

export const laterCapabilities =
  behavior<LaterContext>().capability(laterModule);
