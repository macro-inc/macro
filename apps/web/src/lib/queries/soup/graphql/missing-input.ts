import type { AttributedError } from '@macro-inc/observability';

/**
 * Why a Soup page was asked for while the list had no network input.
 * - `untranslatable`: the request has no GraphQL translation. The Soup facade
 *   routes these to REST before a page is asked for.
 * - `by-id-unresolved`: a by-ID list's cache has resolved no IDs to fetch for
 *   its current ID set, either not yet or none left uncached.
 * - `cache-reset`: the IDs were resolved, then the cache generation changed
 *   (an engine replaced after an owner handoff, a new cache host), so they no
 *   longer apply and the page chain built from them has no input.
 */
export type SoupMissingInputReason =
  | 'untranslatable'
  | 'by-id-unresolved'
  | 'cache-reset';

/** Whether the missing input was for a list's first page or a next page. */
export type SoupMissingInputPage = 'first' | 'continuation';

/** The scope a by-ID input was resolved for, and the cache generation it was resolved in. */
type ResolvedInput = { scope: object; generation: number };

/**
 * Classifies a missing input from the last by-ID resolution. A next page
 * belongs to the page chain started from that resolution, so a reset since
 * then ends it whatever the request is now, translatable or not. For a first
 * page, a reset counts only when that resolution was for the scope asked for
 * now; otherwise the new scope is simply not resolved yet. Scopes compare by
 * identity, as the live query's own input check does.
 */
export function missingSoupInputReason(current: {
  scope: object | undefined;
  generation: number;
  page: SoupMissingInputPage;
  /** The last by-ID resolution; absent for a list that is not by ID. */
  resolved: ResolvedInput | undefined;
}): SoupMissingInputReason {
  const { resolved } = current;
  const reset =
    resolved !== undefined && resolved.generation !== current.generation;
  if (reset && current.page === 'continuation') return 'cache-reset';
  if (current.scope === undefined) return 'untranslatable';
  return reset && resolved.scope === current.scope
    ? 'cache-reset'
    : 'by-id-unresolved';
}

const MESSAGES = {
  untranslatable: 'GraphQL Soup input has no GraphQL translation',
  'by-id-unresolved': 'GraphQL Soup by-ID input is not resolved yet',
  'cache-reset': 'GraphQL Soup by-ID input was reset with the cache',
} satisfies Record<SoupMissingInputReason, string>;

/** A Soup page was asked for without an input; each reason has its own message. */
export class SoupMissingInputError extends Error implements AttributedError {
  override readonly name = 'SoupMissingInputError';
  readonly telemetryAttributes: {
    reason: SoupMissingInputReason;
    'soup.page': SoupMissingInputPage;
    /** This list's count of missing inputs so far: above 1 means it retried. */
    'soup.missing_input_count': number;
  };

  constructor(
    readonly reason: SoupMissingInputReason,
    page: SoupMissingInputPage,
    count: number
  ) {
    super(MESSAGES[reason]);
    this.telemetryAttributes = {
      reason,
      'soup.page': page,
      'soup.missing_input_count': count,
    };
  }
}
