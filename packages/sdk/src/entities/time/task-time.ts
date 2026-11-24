import type { TimeEntryCursor } from '../../../generated/storage/types.gen';
import { iterate, MacroError, paginate } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import type { Task } from '../tasks/task';
import { unwrapTime } from './errors';
import { checkDay, checkMinutes, TimeEntry } from './time-entry';
import { Timer } from './timer';

/** Typed time to log on a task. */
export interface LogTimeOptions {
  /** Length in whole minutes, at most 24 hours (1440). */
  minutes: number;
  /**
   * The day the work was done, `YYYY-MM-DD`, in the logger's own calendar;
   * today in UTC when omitted.
   */
  date?: string;
  /** What the time was spent on, up to 2000 characters. */
  note?: string;
  /** When the work started; give it with `endedAt` or not at all. */
  startedAt?: Date;
  /** When the work ended, after `startedAt`. */
  endedAt?: Date;
  /** A UUID you generate; resend the same key and input to retry without logging twice. */
  idempotencyKey?: string;
}

/** How to page a task's time entries. */
export interface TimeEntriesOptions {
  /** Entries per request, 1 to 200; 50 when omitted. */
  pageSize?: number;
  /** Yield at most this many entries in all. */
  maxItems?: number;
}

/** How `task.startTimer` starts. */
export interface StartTimerOptions {
  /**
   * IANA time zone (`Europe/Paris`) whose calendar day the entry of a timer
   * this start stops takes; UTC when omitted.
   */
  timeZone?: string;
  /** A UUID you generate; resend the same key to retry without starting twice. */
  idempotencyKey?: string;
}

/** A started timer, and the entry saved for the timer it replaced. */
export interface TimerStart {
  /** The timer now running. */
  timer: Timer;
  /** The entry saved when a timer running on another task was stopped. */
  stopped?: TimeEntry;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** @internal `task.logTime`. */
export async function logTime(
  client: MacroClient,
  task: Task,
  opts: LogTimeOptions,
): Promise<TimeEntry> {
  if (typeof opts !== 'object' || opts === null)
    throw new MacroError(
      'task.logTime takes an options object, { minutes, date, note }.',
    );
  rejectUnknownOptions('task.logTime', opts, {
    minutes: true,
    date: true,
    note: true,
    startedAt: true,
    endedAt: true,
    idempotencyKey: true,
  });
  checkMinutes('task.logTime', opts.minutes);
  const date = opts.date ?? today();
  checkDay('task.logTime', date);
  const { entry } = unwrapTime(
    await client.storage.logTime({
      path: { task_id: task.id },
      body: {
        id: opts.idempotencyKey,
        date,
        minutes: opts.minutes,
        note: opts.note,
        startedAt: opts.startedAt?.toISOString(),
        endedAt: opts.endedAt?.toISOString(),
      },
    }),
  );
  return TimeEntry.from(client, entry);
}

/** @internal `task.timeEntries`. */
export function timeEntries(
  client: MacroClient,
  task: Task,
  opts?: TimeEntriesOptions,
): AsyncGenerator<TimeEntry> {
  return iterate('task.timeEntries', opts, { pageSize: true }, () =>
    paginate<TimeEntry, TimeEntryCursor>(async (cursor) => {
      const page = unwrapTime(
        await client.storage.listTimeEntries({
          path: { task_id: task.id },
          query: {
            limit: opts?.pageSize,
            cursorDate: cursor?.date,
            cursorId: cursor?.id,
          },
        }),
      );
      return {
        items: page.entries.map((entry) => TimeEntry.from(client, entry)),
        nextCursor: page.nextCursor,
      };
    }),
  );
}

/** @internal `task.timeLogged`. */
export async function timeLogged(
  client: MacroClient,
  task: Task,
): Promise<number> {
  const { totalMinutes } = unwrapTime(
    await client.storage.listTimeEntries({
      path: { task_id: task.id },
      query: { limit: 1 },
    }),
  );
  return totalMinutes;
}

/** @internal `task.startTimer`. */
export async function startTimer(
  client: MacroClient,
  task: Task,
  opts: StartTimerOptions = {},
): Promise<TimerStart> {
  if (typeof opts !== 'object' || opts === null)
    throw new MacroError(
      'task.startTimer takes an options object, { timeZone }.',
    );
  rejectUnknownOptions('task.startTimer', opts, {
    timeZone: true,
    idempotencyKey: true,
  });
  const started = unwrapTime(
    await client.storage.startTimer({
      body: {
        id: opts.idempotencyKey,
        taskId: task.id,
        timeZone: opts.timeZone,
      },
    }),
    (record) => Timer.from(client, record),
  );
  return {
    timer: Timer.from(client, started.timer),
    ...(started.stopped && {
      stopped: TimeEntry.from(client, started.stopped.entry),
    }),
  };
}
