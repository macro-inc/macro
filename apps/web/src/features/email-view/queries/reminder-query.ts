import {
  doneRemindersFilter,
  firedRemindersFilter,
  scheduledRemindersFilter,
} from '@app/features/next-soup/filters/predicates';
import {
  clause,
  compileClause,
  confine,
  type FacetSelection,
} from '@app/features/soup';
import type { EntityData } from '@entity';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import { match } from 'ts-pattern';
import type { EmailFilterGroupId, ReminderStatusFilter } from '../types';

export const REMINDER_STATUS_GROUP_ID: EmailFilterGroupId = 'reminders';

/**
 * The status the Reminders tab lists when nothing is selected. Active is the
 * inbox — fired and waiting on you — the same default the standalone
 * Reminders view had before it moved under Email.
 */
export const DEFAULT_REMINDER_STATUS: ReminderStatusFilter = 'active';

const REMINDER_STATUSES: ReminderStatusFilter[] = [
  'active',
  'scheduled',
  'done',
];

const isReminderStatus = (value: string): value is ReminderStatusFilter =>
  (REMINDER_STATUSES as string[]).includes(value);

/** The single-select status the facets carry, or the default when unset. */
export function reminderStatusFromFacets(
  facets: FacetSelection
): ReminderStatusFilter {
  const selected = facets[REMINDER_STATUS_GROUP_ID]?.[0];
  return selected !== undefined && isReminderStatus(selected)
    ? selected
    : DEFAULT_REMINDER_STATUS;
}

/**
 * The server-side split. `reminderCompleted: false` on the open statuses is
 * load-bearing beyond filtering: it is what the normalized cache matches (as
 * `"comp":false`) to drop a reminder the moment it is marked done, rather
 * than on the next refetch. `reminderFired` is resolved against the database
 * clock — a client timestamp would land in the query key and change every
 * render.
 */
function statusClause(status: ReminderStatusFilter) {
  return match(status)
    .with('active', () =>
      clause.and(
        clause.eq('includeReminders', true),
        clause.eq('reminderCompleted', false),
        clause.eq('reminderFired', true)
      )
    )
    .with('scheduled', () =>
      clause.and(
        clause.eq('includeReminders', true),
        clause.eq('reminderCompleted', false),
        clause.eq('reminderFired', false)
      )
    )
    .with('done', () =>
      clause.and(
        clause.eq('includeReminders', true),
        clause.eq('reminderCompleted', true)
      )
    )
    .exhaustive();
}

/**
 * Builds the reminders-only Soup query for the Email view's Reminders tab.
 * Reminders are the one entity type that is opt-in server-side, so naming
 * `includeReminders` both surfaces them and — via `confine`, which
 * NIL-excludes every target the query does not reference — keeps every other
 * type out. Soup orders reminders by when they fire.
 */
export function buildReminderQuery(
  status: ReminderStatusFilter
): SoupAstItemsQueryArgs {
  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      // Active and Done are archives of what already happened, so newest
      // first like every other feed. Scheduled points at future dates, where
      // newest-first would put December above tomorrow.
      sort_direction: status === 'scheduled' ? 'asc' : 'desc',
    },
    body: compileClause(confine({ remf: statusClause(status) })),
  };
}

/** Item-level mirror of `statusClause`, for rows the cache hands back. */
export function reminderMatchesStatus(
  entity: EntityData,
  status: ReminderStatusFilter
): boolean {
  return match(status)
    .with('active', () => firedRemindersFilter(entity))
    .with('scheduled', () => scheduledRemindersFilter(entity))
    .with('done', () => doneRemindersFilter(entity))
    .exhaustive();
}

/**
 * Search narrows the loaded page by description. The search service accepts
 * `reminder_filters` but indexes no reminders, so a service query would only
 * ever answer "no results"; a reminder's whole text is its description, and
 * the list is small enough to match locally.
 */
export function reminderMatchesSearch(
  entity: EntityData,
  search: string
): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return (entity.name ?? '').toLowerCase().includes(term);
}
