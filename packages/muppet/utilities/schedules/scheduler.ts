/**
 * The implementation behind `Schedules`: one loop that fires what is due and
 * sleeps until the next thing is, reading the store every pass so changes
 * take effect at once. It does IO only through the store and the clock it is
 * given.
 */

import { errorMessage } from '../../core/error.ts';
import { source } from '../../core/event.ts';
import type { Clock } from '../time/index.ts';
import {
  instant,
  isoText,
  lengthText,
  milliseconds,
  timeZone,
} from '../time/index.ts';
import {
  due,
  type Entry,
  type Fire,
  type Miss,
  nextFire,
  nextWake,
  type Run,
  type Table,
} from './due.ts';
import { ruleText } from './rrule.ts';
import { check, epoch, type Schedule } from './schedule.ts';
import type { Changed, Fired, Schedules, Status } from './schedules.ts';
import type { ScheduleStore } from './store.ts';

/** The longest the loop sleeps, so a clock that drifts or a missed change is caught. */
const longestSleep = 30_000;

/** One line of English for a schedule. */
const describe = (schedule: Schedule, tz: string): string => {
  if ('every' in schedule)
    return `every ${lengthText(milliseconds(schedule.every))}`;
  if ('at' in schedule) return `once, at ${schedule.at}`;
  return ruleText(schedule.rule, {
    start: instant(schedule.from ?? epoch),
    tz: timeZone(schedule.tz ?? tz),
  });
};

const statusOf = (
  name: string,
  entry: Entry,
  now: Temporal.Instant,
  tz: string
): Status => {
  const known = {
    name,
    schedule: entry.schedule,
    paused: entry.run.paused === true,
    running: entry.run.running === true,
    ...(entry.run.ended === undefined ? {} : { last: entry.run.ended }),
    ...(entry.run.missed === undefined ? {} : { missed: entry.run.missed }),
  };
  try {
    // While it runs, the next firing is the one after this run, as if it ended now.
    const next = nextFire(
      entry.run.running === true
        ? { ...entry, run: { ...entry.run, ended: isoText(now) } }
        : entry,
      now,
      tz
    );
    return {
      ...known,
      when: describe(entry.schedule, tz),
      next: next.when === null ? null : isoText(next.when),
    };
  } catch (error) {
    return {
      ...known,
      when: 'broken',
      next: null,
      error: errorMessage(error),
    };
  }
};

/** Soonest first, then those that won't fire, then by name. */
const soonest = (a: Status, b: Status): number => {
  if (a.next !== b.next) {
    if (a.next === null) return 1;
    if (b.next === null) return -1;
    return a.next < b.next ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

const changeRun = (
  table: Table,
  name: string,
  change: (run: Run) => Run
): Table => {
  const entry = table[name];
  return entry === undefined
    ? table
    : { ...table, [name]: { ...entry, run: change(entry.run) } };
};

/** Nothing runs between passes, so a run still marked running was cut off, e.g. by a restart. */
const recover = (table: Table): Table =>
  Object.values(table).some((entry) => entry.run.running === true)
    ? Object.fromEntries(
        Object.entries(table).map(([name, entry]) => {
          const { running: _, ...run } = entry.run;
          return [name, { ...entry, run }];
        })
      )
    : table;

const start = (table: Table, fire: Fire, now: Temporal.Instant): Table =>
  changeRun(table, fire.name, (run) => ({
    ...run,
    due: isoText(fire.due),
    started: isoText(now),
    running: true,
  }));

const end = (table: Table, name: string, now: Temporal.Instant): Table =>
  changeRun(table, name, ({ running: _, ...run }) => ({
    ...run,
    ended: isoText(now),
  }));

/** Records a firing that was too late, so the next one is the following occurrence. */
const miss = (table: Table, missed: Miss): Table =>
  changeRun(table, missed.name, (run) =>
    missed.kind === 'once'
      ? { ...run, due: isoText(missed.due), spent: true }
      : { ...run, due: isoText(missed.due), missed: (run.missed ?? 0) + 1 }
  );

export const scheduler = ({
  store,
  clock,
  tz,
  signal,
}: {
  readonly store: ScheduleStore;
  readonly clock: Clock;
  /** The zone a rule's wall clock means, unless it names its own. */
  readonly tz: string;
  /** Ends `fired`, e.g. on shutdown. */
  readonly signal?: AbortSignal;
}): Schedules => {
  const zone = timeZone(tz);

  // One read and write at a time, so the loop and changes never lose each other's writes.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
  const read = () => serial(store.read);
  const update = (change: (table: Table) => Table): Promise<Table> =>
    serial(async () => {
      const table = await store.read();
      const next = change(table);
      if (next !== table) await store.write(next);
      return next;
    });

  // Cuts the loop's sleep short when schedules change.
  let nudge = (): void => {};
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const wake = (): void => {
        signal?.removeEventListener('abort', wake);
        resolve();
      };
      nudge = wake;
      signal?.addEventListener('abort', wake);
      void clock.sleep(ms).then(wake);
    });

  const changed = (name: string, table: Table): Changed => {
    const entry = table[name];
    if (entry === undefined) return { kind: 'unknown', name };
    nudge();
    return {
      kind: 'changed',
      status: statusOf(name, entry, clock.now(), zone),
    };
  };

  /** One pass: records what was missed, fires what is due, and says how long to sleep. */
  async function* pass(): AsyncGenerator<Fired, number> {
    try {
      const table = await update(recover);
      const verdict = due(table, clock.now(), zone);
      if (verdict.miss.length > 0)
        await update((current) => verdict.miss.reduce(miss, current));
      for (const fire of verdict.fire) {
        const entry = (
          await update((current) => start(current, fire, clock.now()))
        )[fire.name];
        if (entry === undefined) continue;
        yield {
          name: fire.name,
          due: isoText(fire.due),
          ...(entry.schedule.data === undefined
            ? {}
            : { data: entry.schedule.data }),
        };
        await update((current) => end(current, fire.name, clock.now()));
      }
      // Firing took time, so look again before sleeping.
      if (verdict.fire.length > 0) return 0;
      const now = clock.now();
      const wake = nextWake(await read(), now, zone);
      return wake === undefined
        ? longestSleep
        : Math.min(
            Math.max(wake.epochMilliseconds - now.epochMilliseconds, 0),
            longestSleep
          );
    } catch {
      // The store failed. Try again after the longest sleep.
      return longestSleep;
    }
  }

  async function* loop(): AsyncGenerator<Fired> {
    while (signal?.aborted !== true) {
      const wait = yield* pass();
      if (wait > 0) await sleep(wait);
    }
  }

  return {
    set: async (name, schedule) => {
      const problem = check(name, schedule);
      if (problem !== undefined) return { kind: 'invalid', error: problem };
      return changed(
        name,
        await update((table) => ({ ...table, [name]: { schedule, run: {} } }))
      );
    },
    remove: async (name) => {
      const removed = await serial(async () => {
        const { [name]: entry, ...rest } = await store.read();
        if (entry === undefined) return false;
        await store.write(rest);
        return true;
      });
      if (!removed) return { kind: 'unknown', name };
      nudge();
      return { kind: 'removed', name };
    },
    pause: async (name) =>
      changed(
        name,
        await update((table) =>
          changeRun(table, name, (run) => ({ ...run, paused: true }))
        )
      ),
    resume: async (name) =>
      changed(
        name,
        await update((table) =>
          changeRun(table, name, ({ paused: _, ...run }) => run)
        )
      ),
    list: async () => {
      const now = clock.now();
      return Object.entries(await read())
        .map(([name, entry]) => statusOf(name, entry, now, zone))
        .sort(soonest);
    },
    fired: source(loop()),
  };
};
