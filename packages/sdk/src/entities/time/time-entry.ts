import type { TimeEntry as TimeEntryRecord } from '../../../generated/storage/types.gen';
import { MacroError, MacroNotFoundError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import { MacroEntity } from '../entity';
import { Task } from '../tasks/task';
import { User } from '../users/user';
import { unwrapTime } from './errors';

/** What `entry.edit` changes; fields left out stay as they are. */
export interface TimeEntryChanges {
  /** The day the work was done, `YYYY-MM-DD`, in the logger's own calendar. */
  date?: string;
  /** Length in whole minutes, at most 24 hours. */
  minutes?: number;
  /** What the time was spent on; `null` removes the note. */
  note?: string | null;
  /** When the work started, set together with `endedAt`; `null` clears both. */
  startedAt?: Date | null;
  /** When the work ended, after `startedAt`; `null` clears both. */
  endedAt?: Date | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The span fields of an edit. The server keeps a start and an end together,
 * so `null` for one with the other left out clears both.
 */
function spanChanges(changes: TimeEntryChanges): {
  startedAt?: string | null;
  endedAt?: string | null;
} {
  const { startedAt, endedAt } = changes;
  if (startedAt === undefined && endedAt === undefined) return {};
  if (
    (startedAt === null && endedAt === undefined) ||
    (endedAt === null && startedAt === undefined)
  )
    return { startedAt: null, endedAt: null };
  return {
    ...(startedAt !== undefined && {
      startedAt: startedAt?.toISOString() ?? null,
    }),
    ...(endedAt !== undefined && { endedAt: endedAt?.toISOString() ?? null }),
  };
}

/** @internal Throws unless `date` is a `YYYY-MM-DD` day. */
export function checkDay(method: string, date: unknown): void {
  if (typeof date !== 'string' || !DAY.test(date))
    throw new MacroError(
      `${method}: \`date\` is the day the work was done, as YYYY-MM-DD, not ${String(date)}.`,
    );
}

/** @internal Throws unless `minutes` is a positive whole number. */
export function checkMinutes(method: string, minutes: unknown): void {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1)
    throw new MacroError(
      `${method}: \`minutes\` is a whole number of minutes, at least 1, not ${String(minutes)}.`,
    );
}

/**
 * Time a person logged on a task: a day, a length in minutes and an optional
 * note, typed or saved by a timer. Read them with `task.timeEntries()`; only
 * the person who logged an entry can `edit` or `remove` it.
 */
export class TimeEntry extends MacroEntity<TimeEntryRecord> {
  /**
   * A handle to one of your time entries by id, to `edit` or `remove` it.
   * Its fields come from `task.timeEntries()` or a write's result.
   */
  static byId(client: MacroClient, id: string): TimeEntry {
    return new TimeEntry(client, id);
  }

  /** @internal An entry the API returned. */
  static from(client: MacroClient, record: TimeEntryRecord): TimeEntry {
    return new TimeEntry(client, record.id, record);
  }

  protected async fetch(): Promise<TimeEntryRecord> {
    throw new MacroNotFoundError(
      `Time entry ${this.id} has no single read; list it with task.timeEntries().`,
    );
  }

  /** The task the time was spent on. */
  readonly task = this.mappedField('taskId', (id) =>
    Task.byId(this.client, id),
  );

  /** Who logged it. */
  readonly author = this.mappedField('userId', (id) =>
    User.byId(this.client, id),
  );

  /** The day the work was done, `YYYY-MM-DD`, in the logger's own calendar. */
  readonly date = this.field('date');

  /** Length in whole minutes. */
  readonly minutes = this.field('minutes');

  /** What the time was spent on, if noted. */
  readonly note = this.field('note');

  /** When the work started, if known (RFC 3339). */
  readonly startedAt = this.field('startedAt');

  /** When the work ended, if known (RFC 3339). */
  readonly endedAt = this.field('endedAt');

  /** `manual` when typed, `timer` when a timer saved it. */
  readonly source = this.field('source');

  /** When it was logged (RFC 3339). */
  readonly createdAt = this.field('createdAt');

  /** When it last changed (RFC 3339). */
  readonly updatedAt = this.field('updatedAt');

  /**
   * Change your own entry: only its author can, and the task's Time logged
   * follows. Fields left out stay; `note: null` removes the note. Throws
   * `NotTimeEntryAuthorError` on someone else's entry.
   *
   * @write
   * @idempotent
   */
  async edit(changes: TimeEntryChanges): Promise<this> {
    if (typeof changes !== 'object' || changes === null)
      throw new MacroError(
        'timeEntry.edit takes an options object, { minutes, date, note, ... }.',
      );
    rejectUnknownOptions('timeEntry.edit', changes, {
      date: true,
      minutes: true,
      note: true,
      startedAt: true,
      endedAt: true,
    });
    if (changes.date !== undefined) checkDay('timeEntry.edit', changes.date);
    if (changes.minutes !== undefined)
      checkMinutes('timeEntry.edit', changes.minutes);
    const { entry } = unwrapTime(
      await this.client.storage.updateTimeEntry({
        path: { entry_id: this.id },
        body: {
          ...(changes.date !== undefined && { date: changes.date }),
          ...(changes.minutes !== undefined && { minutes: changes.minutes }),
          ...(changes.note !== undefined && { note: changes.note }),
          ...spanChanges(changes),
        },
      }),
    );
    this.detail.set(entry);
    return this;
  }

  /**
   * Delete your own entry: only its author can, and the task's Time logged
   * drops by its length. Throws `NotTimeEntryAuthorError` on someone else's.
   *
   * @destructive
   * @idempotent
   */
  async remove(): Promise<void> {
    unwrapTime(
      await this.client.storage.deleteTimeEntry({
        path: { entry_id: this.id },
      }),
    );
    this.detail.clear();
  }
}
