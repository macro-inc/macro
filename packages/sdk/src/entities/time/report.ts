import { match } from 'ts-pattern';
import type {
  TimeGrouping,
  TimeGroupKey as TimeGroupKeyRecord,
  TimeScopeName,
  TimeTotal as TimeTotalRecord,
} from '../../../generated/storage/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import type { Initiative } from '../initiatives/initiative';
import { Task } from '../tasks/task';
import { User } from '../users/user';
import { unwrapTime } from './errors';
import { checkDay } from './time-entry';

export type { TimeGrouping };

/** The days a time report covers, both included, at most 366. */
export interface TimePeriodOptions {
  /** The first day, `YYYY-MM-DD`, in the loggers' own calendars. */
  from: string;
  /** The last day, `YYYY-MM-DD`, at most 365 days after `from`. */
  to: string;
}

/** The days and grouping of a time summary. */
export interface TimeSummaryOptions extends TimePeriodOptions {
  /** What the totals are grouped by: `person`, `task` or `day`. */
  groupBy: TimeGrouping;
  /** What each group is split by; another grouping than `groupBy`. */
  thenBy?: TimeGrouping;
}

/** Whose time `macro.time.summary` and `macro.time.export` read. */
export interface TimeScopeOptions {
  /** `mine` for your own time, `team` for your team's current members, you included. */
  scope: 'mine' | 'team';
}

/** What one total is for: a person, a task or a day. */
export type TimeTotalKey =
  | { by: 'person'; person: User }
  | { by: 'task'; task: Task }
  | { by: 'day'; date: string };

/** Minutes logged for one person, task or day. */
export interface TimeTotal {
  /** What the total is for. */
  key: TimeTotalKey;
  /** Minutes logged. */
  minutes: number;
}

/** One group's total, and its split by the second grouping. */
export interface TimeGroup extends TimeTotal {
  /** Tasks with time in the group. */
  taskCount: number;
  /** The group's totals by `thenBy`, in report order; empty without one. */
  rows: TimeTotal[];
}

/** The time a scope logged over a period, on the tasks you can see. */
export interface TimeSummary {
  /** The first day, `YYYY-MM-DD`. */
  from: string;
  /** The last day, `YYYY-MM-DD`. */
  to: string;
  /** Minutes logged in the period. */
  totalMinutes: number;
  /** Tasks with time in the period. */
  taskCount: number;
  /** For a project, its tasks you can see that are out of the Trash, with time or not. */
  projectTaskCount?: number;
  /**
   * False when the scope held more than 5,000 tasks and only the first 5,000
   * were read; narrow the period or the scope for the rest.
   */
  complete: boolean;
  /**
   * Totals by `groupBy`: days in calendar order, people and tasks with the
   * most time first. Grouped by person, your own and your team's summaries
   * list every current member, with or without time.
   */
  groups: TimeGroup[];
  /** Totals by `thenBy` across all groups; empty without one. */
  thenTotals: TimeTotal[];
}

/** A scope's entries over a period as CSV text. */
export interface TimeExport {
  /**
   * The CSV, oldest day first: Date, Person (an email), Task, Minutes, Hours,
   * Note and Source (`typed` or `timer`) per entry.
   */
  csv: string;
  /** Entries written. */
  rows: number;
  /**
   * False when entries were left out: past 10,000 entries or 16 MiB, or past
   * the first 5,000 tasks of the scope.
   */
  complete: boolean;
}

/** @internal Whose time one report call reads. */
export type ReportScope =
  | { scope: 'project'; initiative: Initiative }
  | { scope: 'mine' | 'team' };

const GROUPINGS: readonly TimeGrouping[] = ['person', 'task', 'day'];

function checkGrouping(method: string, field: string, value: unknown): void {
  if (!GROUPINGS.includes(value as TimeGrouping))
    throw new MacroError(
      `${method}: \`${field}\` is one of person, task or day, not ${String(value)}.`,
    );
}

function checkScope(method: string, scope: ReportScope): void {
  if (!['project', 'mine', 'team'].includes(scope.scope))
    throw new MacroError(
      `${method}: \`scope\` is 'mine' or 'team', not ${String(scope.scope)}; a project's time is initiative.timeSummary.`,
    );
}

function checkPeriod(method: string, opts: TimePeriodOptions): void {
  checkDay(method, opts.from);
  checkDay(method, opts.to);
}

function scopeQuery(scope: ReportScope): {
  scope: TimeScopeName;
  projectId?: string;
} {
  return scope.scope === 'project'
    ? { scope: 'project', projectId: scope.initiative.id }
    : { scope: scope.scope };
}

function keyOf(client: MacroClient, key: TimeGroupKeyRecord): TimeTotalKey {
  return match(key)
    .with(
      { by: 'person' },
      ({ userId }): TimeTotalKey => ({
        by: 'person',
        person: User.byId(client, userId),
      }),
    )
    .with(
      { by: 'task' },
      ({ taskId }): TimeTotalKey => ({
        by: 'task',
        task: Task.byId(client, taskId),
      }),
    )
    .with({ by: 'day' }, ({ date }): TimeTotalKey => ({ by: 'day', date }))
    .exhaustive((unknown) => {
      throw new MacroError(
        `A time summary total is for something this SDK does not know: ${JSON.stringify(unknown)}.`,
      );
    });
}

function totalOf(client: MacroClient, total: TimeTotalRecord): TimeTotal {
  return { key: keyOf(client, total.key), minutes: total.minutes };
}

/** @internal `initiative.timeSummary` and `macro.time.summary`. */
export async function readTimeSummary(
  client: MacroClient,
  method: string,
  scope: ReportScope,
  opts: TimeSummaryOptions,
): Promise<TimeSummary> {
  if (typeof opts !== 'object' || opts === null)
    throw new MacroError(
      `${method} takes an options object, { from, to, groupBy, thenBy }.`,
    );
  rejectUnknownOptions(method, opts, {
    ...(scope.scope !== 'project' && { scope: true }),
    from: true,
    to: true,
    groupBy: true,
    thenBy: true,
  });
  checkScope(method, scope);
  checkPeriod(method, opts);
  checkGrouping(method, 'groupBy', opts.groupBy);
  if (opts.thenBy !== undefined) checkGrouping(method, 'thenBy', opts.thenBy);
  const summary = unwrapTime(
    await client.storage.getTimeSummary({
      query: {
        ...scopeQuery(scope),
        from: opts.from,
        to: opts.to,
        groupBy: opts.groupBy,
        thenBy: opts.thenBy,
      },
    }),
  );
  return {
    from: summary.from,
    to: summary.to,
    totalMinutes: summary.totalMinutes,
    taskCount: summary.taskCount,
    projectTaskCount: summary.scopeTaskCount ?? undefined,
    complete: summary.complete,
    groups: summary.groups.map((group) => ({
      key: keyOf(client, group.key),
      minutes: group.minutes,
      taskCount: group.taskCount,
      rows: group.rows.map((row) => totalOf(client, row)),
    })),
    thenTotals: summary.thenTotals.map((total) => totalOf(client, total)),
  };
}

/** @internal `initiative.exportTime` and `macro.time.export`. */
export async function readTimeExport(
  client: MacroClient,
  method: string,
  scope: ReportScope,
  opts: TimePeriodOptions,
): Promise<TimeExport> {
  if (typeof opts !== 'object' || opts === null)
    throw new MacroError(`${method} takes an options object, { from, to }.`);
  rejectUnknownOptions(method, opts, {
    ...(scope.scope !== 'project' && { scope: true }),
    from: true,
    to: true,
  });
  checkScope(method, scope);
  checkPeriod(method, opts);
  const exported = unwrapTime(
    await client.storage.exportTime({
      query: { ...scopeQuery(scope), from: opts.from, to: opts.to },
    }),
  );
  return {
    csv: exported.csv,
    rows: exported.rows,
    complete: exported.complete,
  };
}
