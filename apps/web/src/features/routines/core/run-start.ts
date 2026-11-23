import type { HistoryRun, HistoryStart } from './history';
import { describeCronExpression, eventLabel } from './routine-triggers';

/** An item an event run is about that the app can open. */
export type RunItem = { block: 'email' | 'channel' | 'task'; id: string };

const ITEM_BLOCKS: [prefix: string, block: RunItem['block']][] = [
  ['email.', 'email'],
  ['channel.', 'channel'],
  ['task.', 'task'],
];

/** The item an event run is about, when the app can open it. */
export function runItem(start: HistoryStart): RunItem | undefined {
  if (start.kind !== 'event' || !start.entityId) return undefined;
  const block = ITEM_BLOCKS.find(([prefix]) =>
    start.event.startsWith(prefix)
  )?.[1];
  return block ? { block, id: start.entityId } : undefined;
}

/** What started a run, such as "Every day at 9:00 AM (Europe/Paris)". */
export function describeRunStart(
  start: HistoryStart,
  /** A person's name for their user id, "you" for the viewer. */
  person: (id: string) => string
): string {
  switch (start.kind) {
    case 'schedule': {
      const schedule =
        describeCronExpression(start.schedule) ?? 'On its schedule';
      return start.timezone ? `${schedule} (${start.timezone})` : schedule;
    }
    case 'event':
      return eventLabel(start.event);
    case 'manual':
      return `Run by ${person(start.by)}`;
  }
}

/** A minute apart or more: the run started later than it counts as. */
const LATE_MS = 60_000;

/**
 * The run's header line: what started it, when it counts as happening when
 * that isn't when it started, and since when, e.g. "Every day at 9:00 AM
 * (Europe/Paris) · since Oct 31, 9:00 AM".
 */
export function runStartLine(
  run: HistoryRun,
  startedAt: string | null | undefined,
  person: (id: string) => string,
  formatTime: (iso: string) => string
): string {
  const parts = [describeRunStart(run.start, person)];
  const late =
    startedAt !== null &&
    startedAt !== undefined &&
    Math.abs(Date.parse(startedAt) - Date.parse(run.at)) >= LATE_MS;
  if (late)
    parts.push(
      run.start.kind === 'event'
        ? `happened ${formatTime(run.at)}`
        : `due ${formatTime(run.at)}`
    );
  parts.push(
    run.previousAt ? `since ${formatTime(run.previousAt)}` : 'first run'
  );
  return parts.join(' · ');
}
