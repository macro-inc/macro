import type { DateRangeFilter } from '@app/features/soup/filters';
import { startOfDay, startOfYear, subDays, subYears } from 'date-fns';

export const DRIVE_CREATOR_PRESET_ME = '__me__';
export const DRIVE_CREATOR_PRESET_MY_AGENTS = '__my_agents__';
export const DRIVE_CREATOR_PRESET_TEAM_AGENTS = '__team_agents__';

export type DriveCreatorPresetId =
  | typeof DRIVE_CREATOR_PRESET_ME
  | typeof DRIVE_CREATOR_PRESET_MY_AGENTS
  | typeof DRIVE_CREATOR_PRESET_TEAM_AGENTS;

export const DRIVE_CREATOR_PRESETS: readonly DriveCreatorPresetId[] = [
  DRIVE_CREATOR_PRESET_ME,
  DRIVE_CREATOR_PRESET_MY_AGENTS,
  DRIVE_CREATOR_PRESET_TEAM_AGENTS,
];

export function isDriveCreatorPreset(id: string): id is DriveCreatorPresetId {
  return (
    id === DRIVE_CREATOR_PRESET_ME ||
    id === DRIVE_CREATOR_PRESET_MY_AGENTS ||
    id === DRIVE_CREATOR_PRESET_TEAM_AGENTS
  );
}

export type DriveCreatorResolutionContext = {
  userId?: string;
  myAgentIds?: readonly string[];
  teamAgentIds?: readonly string[];
};

/**
 * Expands a `created-by` option ID (either a special preset like `__me__` or
 * `__my_agents__`, or a raw user ID) into concrete owner IDs to match.
 * Returns an empty array when a preset matches no concrete IDs (e.g. a user
 * with no agents yet), so callers treat it as an empty match rather than
 * dropping the filter.
 */
export function resolveCreatorOptionIds(
  optionId: string,
  context: DriveCreatorResolutionContext
): string[] {
  if (optionId === DRIVE_CREATOR_PRESET_ME) {
    return context.userId ? [context.userId] : [];
  }
  if (optionId === DRIVE_CREATOR_PRESET_MY_AGENTS) {
    return [...new Set(context.myAgentIds ?? [])];
  }
  if (optionId === DRIVE_CREATOR_PRESET_TEAM_AGENTS) {
    return [...new Set(context.teamAgentIds ?? [])];
  }
  return optionId ? [optionId] : [];
}

export type DriveModifiedPresetId =
  | 'today'
  | 'last-7-days'
  | 'last-30-days'
  | 'this-year'
  | 'last-year';

export const DRIVE_MODIFIED_PRESETS: readonly DriveModifiedPresetId[] = [
  'today',
  'last-7-days',
  'last-30-days',
  'this-year',
  'last-year',
];

export function isDriveModifiedPreset(id: string): id is DriveModifiedPresetId {
  return (DRIVE_MODIFIED_PRESETS as readonly string[]).includes(id);
}

/**
 * Converts a Google-Drive-style modified preset into an ISO `DateRangeFilter`
 * anchored to the start of `now`'s local day so query keys stay stable within
 * a day.
 */
export function modifiedPresetRange(
  preset: DriveModifiedPresetId,
  now: Date = new Date()
): DateRangeFilter {
  const todayStart = startOfDay(now);
  switch (preset) {
    case 'today':
      return { gte: todayStart.toISOString() };
    case 'last-7-days':
      return { gte: subDays(todayStart, 7).toISOString() };
    case 'last-30-days':
      return { gte: subDays(todayStart, 30).toISOString() };
    case 'this-year':
      return { gte: startOfYear(now).toISOString() };
    case 'last-year': {
      const thisYearStart = startOfYear(now);
      const lastYearStart = startOfYear(subYears(now, 1));
      return {
        gte: lastYearStart.toISOString(),
        lt: thisYearStart.toISOString(),
      };
    }
  }
}

function toTimestampMs(
  value: string | Date | number | null | undefined
): number {
  if (value == null) return Number.NaN;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

/** Client-side check matching an entity timestamp against a `DateRangeFilter`. */
export function matchesDateRange(
  timestamp: string | Date | number | null | undefined,
  range: DateRangeFilter
): boolean {
  const ms = toTimestampMs(timestamp);
  if (Number.isNaN(ms)) return false;
  if (range.gte && ms < Date.parse(range.gte)) return false;
  if (range.gt && ms <= Date.parse(range.gt)) return false;
  if (range.lte && ms > Date.parse(range.lte)) return false;
  if (range.lt && ms >= Date.parse(range.lt)) return false;
  return true;
}
