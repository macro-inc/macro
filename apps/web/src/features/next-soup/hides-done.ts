import type { FilterID } from '@app/features/next-soup/filters/configs/';

/**
 * Active "focus" predicates that exclude done entities. When one of these is
 * active, marking an entity done removes it from the list — so its row should
 * collapse before being removed rather than disappearing instantly, and
 * whatever had focus has to move off it.
 *
 * The inbox tabs activate `inbox` / `noise` rather than the standalone
 * `not-done` predicate (see `soup-filter-presets.ts`), so all three are
 * included here.
 */
export const HIDES_DONE_PREDICATES: FilterID[] = ['not-done', 'inbox', 'noise'];

/**
 * Whether this list hides done rows — see `HIDES_DONE_PREDICATES`.
 *
 * Takes the predicate store structurally rather than a whole `SoupState`, so
 * asking the question costs nothing but a type: `create-soup-state` pulls in
 * the sort configs and the filter registry behind it.
 */
export const soupHidesDoneRows = (soup: {
  predicates: { isActive: (id: FilterID) => boolean };
}): boolean => HIDES_DONE_PREDICATES.some((id) => soup.predicates.isActive(id));
