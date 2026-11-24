import type {
  CacheHost,
  CalendarCommitArgs,
  CalendarRangeCacheArgs,
  CalendarRangeCacheResult,
} from '@graphql-cache/index';
import type { CalendarOccurrenceItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { vi } from 'vitest';
import { markCalendarCacheAnswered } from '../readiness';
import {
  type CalendarChangesPage,
  CalendarSyncController,
} from '../sync-controller';

type OccurrenceFragment = CalendarOccurrenceItemFieldsFragment;

const occurrenceRecordKey = (occurrence: OccurrenceFragment) =>
  `GraphqlCalendarOccurrence:${occurrence.id}`;

const timedBounds = (occurrence: OccurrenceFragment) =>
  occurrence.time.__typename === 'GraphqlTimedEventTime'
    ? [Date.parse(occurrence.time.startsAt), Date.parse(occurrence.time.endsAt)]
    : [Number.NaN, Number.NaN];

/**
 * A calendar cache that has covered every week and holds `initial`, with a
 * delta that brings it forward by the events deleted on the server since it
 * last ran. `delta.mode` makes the delta fail, or hold until `release`;
 * `state.pendingWrite` marks its ranges as shaped by a pending write.
 */
export function fakeCalendarCache(initial: OccurrenceFragment[]) {
  const records = new Map(
    initial.map((occurrence) => [occurrenceRecordKey(occurrence), occurrence])
  );
  const listeners = new Set<(revision: string) => void>();
  let revision = 1;
  let seq = 1;
  const deletedOnServer: string[] = [];
  const delta = { mode: 'apply' as 'apply' | 'fail' | 'hold' };
  const state = { pendingWrite: false };
  let held = Promise.withResolvers<void>();

  const host = {
    calendarRange: vi.fn(
      async (
        args: CalendarRangeCacheArgs
      ): Promise<CalendarRangeCacheResult> => ({
        kind: 'range',
        revision: String(revision) as never,
        occurrenceKeys:
          args.endMs === 0
            ? []
            : [...records.entries()]
                .filter(([, occurrence]) => {
                  const [start, end] = timedBounds(occurrence);
                  return start < args.endMs && end > args.startMs;
                })
                .map(([key]) => key),
        gaps: [],
        freshness: 'fresh',
        uncertainEventKeys: [],
        optimistic: state.pendingWrite,
        watermark: [{ linkId: 'link-1', seq: String(seq) }],
      })
    ),
    calendarCommit: vi.fn(async (commit: CalendarCommitArgs) => {
      const deleted = new Set(
        (commit.deletedEventKeys ?? []).map((key) =>
          key.replace('GraphqlCalendarEvent:', '')
        )
      );
      for (const [key, occurrence] of records) {
        if (deleted.has(occurrence.eventId)) records.delete(key);
      }
      revision += 1;
      queueMicrotask(() => {
        for (const listener of listeners) listener(String(revision));
      });
      return {
        kind: 'committed' as const,
        revision: String(revision) as never,
        changed: [],
      };
    }),
    onCacheChanged: (listener: (revision: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: String(revision) as never,
      records: keys.flatMap((recordKey) => {
        const record = records.get(recordKey);
        return record ? [{ recordKey, record }] : [];
      }),
    })),
  } as unknown as CacheHost;
  markCalendarCacheAnswered(host);

  const fetchChanges = vi.fn(async (): Promise<CalendarChangesPage> => {
    if (delta.mode === 'fail') throw new Error('Failed to fetch');
    if (delta.mode === 'hold') await held.promise;
    seq += 1;
    return {
      events: [],
      deletedEventIds: deletedOnServer.splice(0),
      calendars: [],
      deletedCalendarIds: [],
      newWatermark: [{ linkId: 'link-1', seq: String(seq) }],
      hasMore: false,
      resetRequired: false,
    };
  });
  const controller = new CalendarSyncController(host, {
    fetchChanges,
    refetchCalendars: async () => undefined,
  });

  return {
    host,
    controller,
    fetchChanges,
    delta,
    state,
    /** Whether the cache still holds an occurrence of `eventId`. */
    holds: (eventId: string) =>
      [...records.values()].some(
        (occurrence) => occurrence.eventId === eventId
      ),
    /** The server deletes the event; the cache learns it from the next delta. */
    deleteOnServer: (eventId: string) => deletedOnServer.push(eventId),
    /** Lets a held delta finish. */
    release: () => {
      delta.mode = 'apply';
      held.resolve();
      held = Promise.withResolvers<void>();
    },
  };
}
