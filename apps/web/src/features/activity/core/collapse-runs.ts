import type { ActivityAction, ActivityEvent } from './event';

/**
 * One feed line. A `run` is two or more consecutive events by the same
 * actor, on the same entity, of the same action kind (and, for property
 * changes, the same property), read as one line. Events keep the feed's
 * newest-first order: `first` is the newest, `last` the oldest.
 */
export type FeedEntry =
  | { kind: 'single'; event: ActivityEvent }
  | {
      kind: 'run';
      events: ActivityEvent[];
      first: ActivityEvent;
      last: ActivityEvent;
    };

function runKey(event: ActivityEvent): string {
  const property =
    event.action.kind === 'property-changed' ? event.action.property : '';
  return `${event.actorId}\u0000${event.entityId}\u0000${event.action.kind}\u0000${property}`;
}

/** Fold consecutive same-actor, same-entity, same-action events into runs. */
export function collapseRuns(events: ActivityEvent[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  let open: ActivityEvent[] = [];
  let openKey: string | undefined;

  const flush = () => {
    const first = open[0];
    if (!first) return;
    const last = open[open.length - 1] ?? first;
    entries.push(
      open.length === 1
        ? { kind: 'single', event: first }
        : { kind: 'run', events: open, first, last }
    );
    open = [];
    openKey = undefined;
  };

  for (const event of events) {
    const key = runKey(event);
    if (key !== openKey) flush();
    open.push(event);
    openKey = key;
  }
  flush();
  return entries;
}

/** The newest event of an entry, whose actor, entity, and time the line shows. */
export function entryHead(entry: FeedEntry): ActivityEvent {
  return entry.kind === 'single' ? entry.event : entry.first;
}

/** How many events an entry stands for. */
export function entrySize(entry: FeedEntry): number {
  return entry.kind === 'single' ? 1 : entry.events.length;
}

/**
 * The one action an entry reads as. A property run reads as the net change,
 * from the oldest event's `from` to the newest event's `to`.
 */
export function entryAction(entry: FeedEntry): ActivityAction {
  if (entry.kind === 'single') return entry.event.action;
  const newest = entry.first.action;
  const oldest = entry.last.action;
  if (
    newest.kind === 'property-changed' &&
    oldest.kind === 'property-changed'
  ) {
    return { ...newest, from: oldest.from };
  }
  return newest;
}

/** Stable identity for keying a rendered entry. */
export function entryKey(entry: FeedEntry): string {
  return entry.kind === 'single'
    ? entry.event.id
    : `${entry.first.id}..${entry.last.id}`;
}
