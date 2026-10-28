import type { CalendarSource } from '../types';

/** A connected account and the calendars synced from it, for folded pickers. */
export interface CalendarAccountGroup {
  /** Stable grouping key — the inbox link, falling back to its address. */
  key: string;
  /** Connected inbox address shown as the group header. */
  emailAddress: string;
  /** The account's calendars, in the order the source list presented them. */
  calendars: CalendarSource[];
}

/**
 * Folds a flat calendar source list into per-account groups, preserving the
 * source order so primaries and writable calendars stay first within an
 * account and the query's account ordering is kept.
 */
export function groupCalendarSourcesByAccount(
  sources: readonly CalendarSource[]
): CalendarAccountGroup[] {
  const groups: CalendarAccountGroup[] = [];
  const byKey = new Map<string, CalendarAccountGroup>();

  for (const source of sources) {
    const key = source.emailLinkId ?? source.emailAddress ?? source.id;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        emailAddress: source.emailAddress ?? source.name,
        calendars: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.calendars.push(source);
  }

  return groups;
}
