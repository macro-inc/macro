/**
 * Builds the lane list one sync stream runs, from the lane specs and the
 * cache's saved lane state. Pure apart from the two host reads it is given.
 */
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  SyncHost,
  SyncLanePlan,
  SyncLaneState,
} from '@graphql-cache/sync-protocol';
import { CalendarOccurrencesDocument } from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';
import { calendarBackfillMonths } from '../../calendar/graphql/backfill';
import {
  calendarGapWindows,
  toCalendarRangeArgs,
} from '../../calendar/graphql/range';
import { withUpdatedSince } from '../backfill';
import {
  type CalendarLaneSpec,
  type SoupLaneSpec,
  SYNC_PAGE_SIZES,
  type SyncLaneSpec,
  type SyncPass,
  serverQuery,
  syncLaneSpecs,
} from './lanes';

/** The server rejects requests with more lanes. */
export const MAX_SYNC_LANES = 32;

export type SyncPlanHost = Pick<SyncHost, 'syncState'> &
  Pick<CacheHost, 'calendarRange'>;

export type SyncPlanOptions = {
  now?: Date;
  /** Add calendar windows (default true); off while calendars read REST. */
  calendar?: boolean;
  /**
   * Leave out lanes that completed at or after this ISO time: they are
   * current for this run. Retries and second-pass chunks pass their start.
   */
  completedSince?: string;
  /**
   * Soup lanes to leave out: they failed too often in this pass and resume
   * from their saved state on the next one. Calendar windows have positional
   * ids, so they are always planned.
   */
  skipLanes?: ReadonlySet<string>;
};

function completedDuringRun(
  state: SyncLaneState | undefined,
  since: string | undefined
) {
  if (!since || !state?.completedAt || state.nextVariables) return false;
  return Date.parse(state.completedAt) >= Date.parse(since);
}

/**
 * One Soup lane from its saved state: an unfinished pass resumes, a completed
 * hydrate lane catches up from its watermark, anything else starts fresh.
 * Membership and `restartOnRun` lanes always start fresh.
 */
export function soupLanePlan(
  spec: SoupLaneSpec,
  state: SyncLaneState | undefined,
  now: Date
): SyncLanePlan {
  const nowIso = now.toISOString();
  const base = {
    id: spec.id,
    ...spec.query(),
    paging: 'soup' as const,
    kind: spec.kind,
    ...(spec.coverage === undefined ? {} : { coverage: spec.coverage }),
  };
  const fresh = (input = spec.input(now.getTime())): SyncLanePlan => ({
    ...base,
    variables: { input: { initial: input } },
    ...(spec.maxItems === undefined ? {} : { maxItems: spec.maxItems }),
    passStartedAt: nowIso,
  });
  if (spec.kind.kind === 'membership' || spec.restartOnRun || !state)
    return fresh();
  if (state.nextVariables) {
    return {
      ...base,
      variables: state.nextVariables,
      // The cap counts the whole pass; the server counts this stream only.
      ...(spec.maxItems === undefined
        ? {}
        : { maxItems: Math.max(1, spec.maxItems - state.items) }),
      passStartedAt: state.passStartedAt ?? nowIso,
    };
  }
  if (state.completedAt && state.watermark) {
    return fresh(withUpdatedSince(spec.input(now.getTime()), state.watermark));
  }
  return fresh();
}

/** Calendar windows still missing from the cache, nearest month first. */
async function calendarLanePlans(
  host: Pick<CacheHost, 'calendarRange'>,
  spec: CalendarLaneSpec,
  now: Date,
  budget: number
): Promise<SyncLanePlan[]> {
  const lanes: SyncLanePlan[] = [];
  const seen = new Set<string>();
  const { query, operationName } = serverQuery(CalendarOccurrencesDocument);
  for (const range of calendarBackfillMonths(now, spec.months)) {
    if (lanes.length >= budget) break;
    const result = await host.calendarRange(toCalendarRangeArgs(range));
    if (result.kind !== 'range') return lanes;
    for (const window of calendarGapWindows(result.gaps)) {
      const key = JSON.stringify(window.coverage);
      if (seen.has(key) || lanes.length >= budget) continue;
      seen.add(key);
      lanes.push({
        id: `${spec.idPrefix}-${lanes.length}`,
        query,
        operationName,
        variables: {
          input: { ...window.input, first: SYNC_PAGE_SIZES.calendar },
        },
        paging: 'calendar',
        kind: { kind: 'calendar', coverage: window.coverage },
        // Coverage is the checkpoint: an unfinished window is refetched whole
        // so its committed watermark is the lowest of every page.
        passStartedAt: now.toISOString(),
      });
    }
  }
  return lanes;
}

/**
 * Lanes for one stream of `pass`, in load order. Calendar windows take what
 * the lane cap leaves; the farthest are dropped first and come back next run.
 */
export async function buildSyncLanes(
  host: SyncPlanHost,
  pass: SyncPass,
  options: SyncPlanOptions = {}
): Promise<SyncLanePlan[]> {
  const now = options.now ?? new Date();
  const states = new Map(
    (await host.syncState()).map((state) => [state.id, state])
  );
  const slots = syncLaneSpecs(pass).flatMap((spec) =>
    match<SyncLaneSpec, Array<SyncLanePlan | CalendarLaneSpec>>(spec)
      .with({ source: 'calendar' }, (calendar) =>
        options.calendar === false ? [] : [calendar]
      )
      .with({ source: 'soup' }, (soup) => {
        const state = states.get(soup.id);
        if (completedDuringRun(state, options.completedSince)) return [];
        if (options.skipLanes?.has(soup.id)) return [];
        return [soupLanePlan(soup, state, now)];
      })
      .exhaustive(() => [])
  );
  let budget = MAX_SYNC_LANES - slots.filter((slot) => 'id' in slot).length;
  const lanes: SyncLanePlan[] = [];
  for (const slot of slots) {
    if ('id' in slot) {
      lanes.push(slot);
      continue;
    }
    const windows = await calendarLanePlans(host, slot, now, budget);
    budget -= windows.length;
    lanes.push(...windows);
  }
  return lanes;
}
