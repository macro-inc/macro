import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { CALENDAR_ONLY_SEARCH_FILTERS } from '@app/features/calendar-view/calendar-only-search-filters';
import type { CalendarEventEntity, EntityData, WithSearch } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
} from '@queries/soup/search';
import type { CalendarEventSearchScope } from '@service-search/generated/models';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import type { CalendarEventMentionItem } from '../../../../utils/mentionsUtils';

/** The calendar's own search waits for this many characters, and so does the menu. */
const MIN_QUERY_LENGTH = 3;

type UseCalendarEventMentionOptions = {
  searchTerm: Accessor<string>;
  enabled: Accessor<boolean>;
};

/** When the row's instance starts: its occurrence when search resolved one. */
function calendarEventMentionWhen(
  event: Pick<CalendarEventEntity, 'time' | 'occurrenceKey'>
): string | undefined {
  const time = event.time;
  if (!time) return;
  if (time.kind === 'allDay') {
    const date = new Date(
      `${(event.occurrenceKey ?? time.startDate).slice(0, 10)}T00:00:00Z`
    );
    if (Number.isNaN(date.getTime())) return;
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  const start = new Date(event.occurrenceKey ?? time.startsAt);
  if (Number.isNaN(start.getTime())) return;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(start);
}

/** One row per event, pinned to its occurrence when it repeats, as Copy event does. */
export function calendarEventMentionItems(
  results: readonly CalendarEventEntity[]
): CalendarEventMentionItem[] {
  const seen = new Set<string>();
  const items: CalendarEventMentionItem[] = [];
  for (const event of results) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    items.push({
      kind: 'calendarEvent',
      id: event.id,
      data: {
        eventId: event.id,
        title: event.name || 'Untitled event',
        occurrenceKey: event.isRecurring ? event.occurrenceKey : undefined,
        when: calendarEventMentionWhen(event),
      },
    });
  }
  return items;
}

function calendarEventResults(
  results: readonly WithSearch<EntityData>[]
): CalendarEventEntity[] {
  return results.filter(
    (
      entity
    ): entity is WithSearch<Extract<EntityData, { type: 'calendar_event' }>> =>
      entity.type === 'calendar_event'
  );
}

/**
 * Calendar events for the mention menu, through the same unified search the
 * calendar's own search uses, and only where that search is offered. Events
 * shared with the viewer's channels follow the viewer's own, as documents
 * shared that way appear beside their own; mentioning one inserts the shared
 * event, which opens for whoever can already see it.
 */
export function useCalendarEventMention(
  options: UseCalendarEventMentionOptions
) {
  const calendarSearch = useCalendarSearchUiFlag();
  const term = () => options.searchTerm().trim();
  const enabled = () =>
    options.enabled() && calendarSearch() && term().length >= MIN_QUERY_LENGTH;

  const searchArgs = (scope?: CalendarEventSearchScope) =>
    createLazyMemo(
      (): SearchSoupQueryArgs => ({
        params: { cursor: null, page_size: 10 },
        body: {
          match_type: 'partial',
          search_on: 'name',
          query: term(),
          filters: CALENDAR_ONLY_SEARCH_FILTERS,
          calendar_event_scope: scope,
        },
      })
    );
  // Nothing tells a viewer they lost access to an event, so each search asks
  // again when shown, keeping the earlier answer on screen until it lands.
  const searchOptions = () => ({ enabled: enabled(), staleTime: 0 });
  const own = useSearchSoupQuery(searchArgs(), searchOptions);
  const shared = useSearchSoupQuery(
    searchArgs('shared_with_you'),
    searchOptions
  );

  const events = createLazyMemo((): CalendarEventMentionItem[] => {
    if (!enabled() || !queryReadyGate(own)) return [];
    // Shared events only ever follow the viewer's own, so a late answer
    // appends below what is already listed instead of reordering it.
    const sharedEvents = queryReadyGate(shared) ? shared.data : [];
    return calendarEventMentionItems([
      ...calendarEventResults(own.data),
      ...calendarEventResults(sharedEvents),
    ]);
  });

  return { events };
}
