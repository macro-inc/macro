import { SearchBar } from '@app/components/view-shell';
import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import {
  type CalendarTimeFormat,
  DEFAULT_CALENDAR_SOURCE,
} from '@app/features/calendar/types';
import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { safeConferenceUrl } from '@app/features/calendar/utils/conference-link';
import {
  calendarMacroCallUrl,
  macroCallUrl,
} from '@app/features/calendar/utils/macro-call-link';
import { formatCalendarTime } from '@app/features/calendar/utils/time-format';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { IS_MAC } from '@core/constant/isMac';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { debouncedDependent } from '@core/util/debounce';
import { openExternalUrl } from '@core/util/url';
import EmptyStateCalendarSearchGraphic from '@design/empty-state-calendar-search.svg';
import type { EntityData, WithSearch } from '@entity';
import { Popover } from '@kobalte/core/popover';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import QuotesIcon from '@phosphor/quotes.svg';
import RepeatIcon from '@phosphor/repeat.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import {
  useCalendarMentionPreviewQuery,
  useCalendarSearchPreviewsQuery,
} from '@queries/calendar/mention-preview';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';
import { Button, cn, EmptyStatePanel, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createCalendarRange } from '../calendar-range';
import {
  eventTimeFromOccurrenceKey,
  openCalendarEventSplit,
} from '../open-calendar-event';
import {
  CalendarSearchFilters,
  DEFAULT_CALENDAR_SEARCH_FILTERS,
} from './CalendarSearchFilters';

type CalendarSearchResult = WithSearch<
  Extract<EntityData, { type: 'calendar_event' }>
>;
type EventTime = NonNullable<CalendarSearchResult['time']>;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Restrict unified search to calendar events: every other searchable type has
 * a NIL id in its primary field, which the search service reads as "exclude
 * this type", while calendar events carry no id filter and so are the only
 * matches. This mirrors what the Search view's Calendar type produces.
 */
const CALENDAR_ONLY_FILTERS: EntityFilters = {
  document_filters: { document_ids: [NIL_UUID] },
  email_filters: { email_thread_ids: [NIL_UUID] },
  channel_filters: { channel_ids: [NIL_UUID] },
  channel_thread_filters: { thread_ids: [NIL_UUID] },
  chat_filters: { chat_ids: [NIL_UUID] },
  project_filters: { project_ids: [NIL_UUID] },
  call_filters: { call_ids: [NIL_UUID] },
  foreign_entity_filters: { ids: [NIL_UUID] },
};

const searchEventKey = (eventId: string, occurrenceKey?: string) =>
  JSON.stringify([eventId, occurrenceKey ?? null]);

type CalendarMeetingLink = {
  url: string;
  kind: 'macro' | 'google' | 'other';
  label: string;
};

type CalendarSearchEventDetails = {
  conferenceUrl?: string;
  description?: string;
  location?: string;
};

function googleMeetUrlInText(value?: string): string | undefined {
  for (const candidate of value?.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const url = safeConferenceUrl(candidate.replace(/&amp;/g, '&'));
    if (url && new URL(url).hostname === 'meet.google.com') return url;
  }
  return undefined;
}

function meetingLinkForEvent(
  event: CalendarSearchResult,
  details?: CalendarSearchEventDetails
): CalendarMeetingLink | undefined {
  // Search metadata describes the series, not a selected recurring instance.
  if (event.isRecurring && (!event.occurrenceKey || !details)) return undefined;

  const description =
    details?.description ??
    (event.isRecurring ? undefined : event.description);
  const macro = calendarMacroCallUrl({
    description,
    location: details?.location,
  });
  if (macro) return { url: macro, kind: 'macro', label: 'Macro call' };

  const googleContent =
    googleMeetUrlInText(details?.location) ??
    googleMeetUrlInText(description);
  if (googleContent) {
    return { url: googleContent, kind: 'google', label: 'Google Meet' };
  }

  const conference = safeConferenceUrl(
    details?.conferenceUrl ?? event.conferenceUrl
  );
  if (!conference) return undefined;
  const macroConference = calendarMacroCallUrl({ conferenceUrl: conference });
  if (macroConference) {
    return { url: macroConference, kind: 'macro', label: 'Macro call' };
  }
  const google = new URL(conference).hostname === 'meet.google.com';
  return {
    url: conference,
    kind: google ? 'google' : 'other',
    label: google ? 'Google Meet' : 'meeting',
  };
}

const MIN_QUERY_LENGTH = 3;

const dateWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateNoYear = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function formatDateLabel(date: Date): string {
  const formatter =
    date.getFullYear() === new Date().getFullYear() ? dateNoYear : dateWithYear;
  return formatter.format(date);
}

/** The date/time an event row resolved to, matching the calendar's clock. */
function formatEventWhen(
  time: EventTime | undefined,
  timeFormat: CalendarTimeFormat
): string {
  if (!time) return '';
  if (time.kind === 'allDay') {
    const date = parseLocalDate(time.startDate);
    return date ? `${formatDateLabel(date)} · All day` : '';
  }
  const start = new Date(time.startsAt);
  if (Number.isNaN(start.getTime())) return '';
  return `${formatDateLabel(start)} · ${formatCalendarTime(start, timeFormat)}`;
}

/**
 * Read-only card for a result the calendar cannot navigate to: occurrences
 * older than the backend's rolling materialized window aren't fetchable, so
 * there is nothing to focus and no editable event to open. The card's identity
 * comes from the selected row; the mention preview supplements the guest count.
 * A location only appears when the same occurrence resolves.
 */
function CalendarEventPreviewContent(props: {
  event: CalendarSearchResult;
  color: string;
  location?: string;
  timeFormat: CalendarTimeFormat;
  onBack: () => void;
}) {
  let backRef: HTMLButtonElement | undefined;
  // Pull focus into the card as it replaces the search body. A non-modal
  // Kobalte popover dismisses on focus-outside, and the vacated input would
  // otherwise drop focus to <body> and close the popover before it shows.
  onMount(() => backRef?.focus());

  // Supplemental meeting-level detail only. The preview's own `time` is
  // deliberately unused: for an out-of-range hit the requested occurrence
  // isn't materialized, so the endpoint resolves a DIFFERENT instance — the
  // row already carries the occurrence the user selected.
  const previewQuery = useCalendarMentionPreviewQuery(() => ({
    eventId: props.event.id,
    occurrenceKey: props.event.occurrenceKey,
  }));

  const when = () =>
    [formatEventWhen(props.event.time, props.timeFormat), props.location?.trim()]
      .filter(Boolean)
      .join(' · ');
  const organizer = () =>
    props.event.organizer?.name || props.event.organizer?.email || '';
  const detail = () => {
    if (previewQuery.isPending) return '';
    const preview = previewQuery.data;
    if (!preview) return '';
    return preview.attendeeCount > 0
      ? `${preview.attendeeCount} guest${preview.attendeeCount === 1 ? '' : 's'}`
      : '';
  };

  return (
    <div class="p-1">
      <button
        ref={backRef}
        type="button"
        onClick={props.onBack}
        class="flex items-center gap-0.5 rounded-md px-2 py-1 text-xs text-ink-muted outline-none hover:text-ink"
      >
        <CaretLeftIcon class="size-3" />
        Back to search
      </button>
      <div class="flex flex-col gap-1 px-2 pb-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            class="size-2.5 shrink-0 rounded-sm"
            style={{ 'background-color': props.color }}
          />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {props.event.name || 'Untitled event'}
          </span>
          <Show when={props.event.isRecurring}>
            <RepeatIcon
              class="size-3 shrink-0 text-ink-muted"
              aria-label="Repeats"
            />
          </Show>
        </div>
        <Show when={when()}>
          {(label) => (
            <span class="truncate text-xs text-ink-muted">{label()}</span>
          )}
        </Show>
        <Show when={organizer()}>
          {(name) => (
            <span class="truncate text-xs text-ink-muted">{name()}</span>
          )}
        </Show>
        <Show when={detail()}>
          {(text) => (
            <span class="truncate text-xs text-ink-muted">{text()}</span>
          )}
        </Show>
        <span class="mt-1 border-t border-edge-muted pt-1.5 text-xs text-ink-extra-muted">
          Outside the calendar's navigable range
        </span>
      </div>
    </div>
  );
}

function CalendarSearchLoadingRows() {
  return (
    <div role="status">
      <span class="sr-only">Searching events…</span>
      <For each={[0, 1, 2, 3]}>
        {(_, index) => (
          <div
            aria-hidden="true"
            class="flex items-center gap-2 rounded-lg p-1.5 px-2"
          >
            <span class="skeleton-shimmer size-4 shrink-0 rounded bg-skeleton" />
            <span class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span
                class={cn(
                  'skeleton-shimmer h-3.5 rounded bg-skeleton',
                  index() % 2 === 0 ? 'w-3/5' : 'w-2/5'
                )}
              />
              <span class="skeleton-shimmer h-2.5 w-2/5 rounded bg-skeleton" />
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * Keyword search over the caller's calendar events, opened from the calendar
 * header. Selecting a result re-aims the singleton Calendar view at that
 * occurrence, the same navigation an event mention or soup row performs.
 */
export function CalendarSearch(
  props: {
    inline?: boolean;
    compact?: boolean;
    expanded?: boolean;
    onExpand?: () => void;
    onDismiss?: () => void;
    onOpenChange?: (open: boolean) => void;
  } = {}
) {
  const searchEnabled = useCalendarSearchUiFlag();
  return (
    <Show when={searchEnabled()}>
      <CalendarSearchControl
        inline={props.inline}
        compact={props.compact}
        expanded={props.expanded}
        onExpand={props.onExpand}
        onDismiss={props.onDismiss}
        onOpenChange={props.onOpenChange}
      />
    </Show>
  );
}

function CalendarSearchControl(props: {
  inline?: boolean;
  compact?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  onDismiss?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const panel = useSplitPanelOrThrow();
  const [open, setOpenInternal] = createSignal(false);
  const setOpen = (next: boolean) => {
    setOpenInternal(next);
    props.onOpenChange?.(next);
  };
  const [rawQuery, setRawQuery] = createSignal('');
  const [filters, setFilters] = createSignal(DEFAULT_CALENDAR_SEARCH_FILTERS);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal(0);
  // Set to the chosen result when it falls outside the navigable range: the
  // popover then floats a read-only preview of it in place of the search body.
  const [previewTarget, setPreviewTarget] =
    createSignal<CalendarSearchResult | null>(null);

  const query = createMemo(() => rawQuery().trim());
  const debouncedQuery = debouncedDependent(query, 250);

  const searchQuery = useSearchSoupQuery(
    () => {
      const selected = filters();
      return {
        params: { page_size: 25 },
        body: {
          search_on: selected.searchOn,
          match_type: selected.matchType,
          query: debouncedQuery(),
          filters: {
            ...CALENDAR_ONLY_FILTERS,
            calendar_event_filters:
              selected.statuses.length ||
              selected.organizers.length ||
              selected.attendees.length
                ? {
                    statuses: selected.statuses.length
                      ? selected.statuses
                      : undefined,
                    organizers: selected.organizers.length
                      ? selected.organizers
                      : undefined,
                    attendees: selected.attendees.length
                      ? selected.attendees
                      : undefined,
                  }
                : undefined,
          },
        },
      };
    },
    () => ({ enabled: open() && query().length >= MIN_QUERY_LENGTH })
  );

  // Trust the results only once the debounce has caught up to what the user
  // typed AND the fetch for it has settled. Otherwise, for up to the debounce
  // interval after a keystroke, `searchQuery.data` still holds the previous
  // query's rows — which would show stale hits and let Enter open the old
  // first event. Mirrors the soup search's `isSearchServiceDebounceSettled`.
  const isCurrent = () =>
    query().length >= MIN_QUERY_LENGTH &&
    query() === debouncedQuery() &&
    !searchQuery.isPending &&
    !(searchQuery.isFetching && !searchQuery.isFetchingNextPage);

  const results = createMemo<CalendarSearchResult[]>(() => {
    if (!isCurrent()) return [];
    return (searchQuery.data ?? []).filter(
      (entity): entity is CalendarSearchResult =>
        entity.type === 'calendar_event'
    );
  });

  const isLoading = () => query().length >= MIN_QUERY_LENGTH && !isCurrent();

  const searchPreviews = useCalendarSearchPreviewsQuery(() =>
    open()
      ? results().map((event) => ({
          eventId: event.id,
          occurrenceKey: event.occurrenceKey,
        }))
      : []
  );
  const previewEventDetails = createMemo(() => {
    const details = new Map<string, CalendarSearchEventDetails>();
    if (!searchPreviews.isSuccess) return details;
    const previews = searchPreviews.data;
    if (!previews) return details;
    const matches = results();
    previews.forEach((item, index) => {
      const match = matches[index];
      const preview = item.event;
      if (item.type !== 'access' || !match || !preview) return;
      if (item.eventId !== match.id) return;
      // The preview can fall back to a different occurrence outside the
      // materialized range. Never attribute its links to the selected instance.
      if (match.occurrenceKey && preview.occurrenceKey !== match.occurrenceKey)
        return;
      details.set(searchEventKey(match.id, match.occurrenceKey), {
        description: preview.description ?? undefined,
        location: preview.location ?? undefined,
      });
    });
    return details;
  });

  // Search results have no calendar IDs. Match loaded occurrences for colors
  // and full instance content while the batched preview request resolves.
  const activeEventDetails = createMemo(() => {
    const byId = new Map<string, { color: string; location?: string }>();
    const byOccurrence = new Map<string, CalendarSearchEventDetails>();
    const data = calendarPager.activeData();
    if (!open() || !data?.occurrencesQuery.isSuccess) {
      return { byId, byOccurrence };
    }
    for (const event of data.events()) {
      byId.set(event.eventId, {
        color: event.calendar.color,
        location: event.location,
      });
      byOccurrence.set(searchEventKey(event.eventId, event.occurrenceKey), {
        conferenceUrl: event.conferenceUrl,
        description: event.description,
        location: event.location,
      });
    }
    return { byId, byOccurrence };
  });
  const colorForEvent = (eventId: string) =>
    activeEventDetails().byId.get(eventId)?.color ?? DEFAULT_CALENDAR_SOURCE.color;
  const detailsForEvent = (event: CalendarSearchResult) => {
    const key = searchEventKey(event.id, event.occurrenceKey);
    return (
      activeEventDetails().byOccurrence.get(key) ??
      previewEventDetails().get(key)
    );
  };
  const locationForEvent = (event: CalendarSearchResult) => {
    const location =
      detailsForEvent(event)?.location ??
      (!event.isRecurring
        ? activeEventDetails().byId.get(event.id)?.location
        : undefined);
    return location && !macroCallUrl(location.trim()) ? location : undefined;
  };
  const subtitleForEvent = (event: CalendarSearchResult) =>
    [
      formatEventWhen(event.time, calendarView.displaySettings.timeFormat),
      locationForEvent(event)?.trim(),
    ]
      .filter(Boolean)
      .join(' · ');

  // Keyboard-highlighted result, clamped so it stays valid as results change.
  const activeIndex = () => {
    const len = results().length;
    return len === 0 ? -1 : Math.min(Math.max(activeRow(), 0), len - 1);
  };
  const moveActive = (delta: number) => {
    const len = results().length;
    if (len === 0) return;
    const next = Math.min(Math.max(activeIndex() + delta, 0), len - 1);
    setActiveRow(next);
    listRef
      ?.querySelector(`[data-result-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const openResult = (event: CalendarSearchResult) => {
    // Resolve the same locator range a go-to would build: the occurrence key
    // anchors it on its own; without one the master's own time stands in.
    const time = event.occurrenceKey
      ? eventTimeFromOccurrenceKey(event.occurrenceKey)
      : event.time;
    const range = time ? createCalendarRange(time) : undefined;

    if (range && isCalendarRangeSupported(range)) {
      setOpen(false);
      void openCalendarEventSplit({
        eventId: event.id,
        occurrenceKey: event.occurrenceKey,
        time: event.occurrenceKey ? undefined : event.time,
      });
      return;
    }

    // Older than the backend's rolling window: the calendar can't navigate to
    // this occurrence, so float a read-only preview instead of a dead click.
    setPreviewTarget(event);
  };

  const closePreview = () => {
    // The <Show> swaps the input back in synchronously, so the ref is live by
    // the next line — no rAF needed to refocus.
    setPreviewTarget(null);
    focusInput();
  };

  const focusInput = () => {
    inputRef?.focus();
    inputRef?.select();
  };
  createEffect(
    on(
      () => props.expanded,
      (expanded) => {
        if (expanded === undefined) return;
        if (!expanded) {
          setOpen(false);
          return;
        }
        focusInput();
        setOpen(true);
      }
    )
  );
  const changeQuery = (value: string) => {
    setRawQuery(value);
    setActiveRow(0);
    if (props.inline) setOpen(true);
  };
  const filterActions = () => (
    <Show when={!props.inline || !props.compact || open()}>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={rawQuery().trim()}>
          <Button
            type="button"
            variant="plain"
            size="icon-sm"
            square
            aria-pressed={filters().matchType === 'exact'}
            label="Exact match"
            class={
              filters().matchType === 'exact'
                ? 'rounded-full bg-active text-ink'
                : 'rounded-full'
            }
            onPointerDown={(event) => event.preventDefault()}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                matchType: current.matchType === 'exact' ? 'partial' : 'exact',
              }))
            }
          >
            <QuotesIcon class="size-4" />
          </Button>
        </Show>
        <CalendarSearchFilters value={filters()} onChange={setFilters} />
      </div>
    </Show>
  );

  const handleSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      const active = results()[activeIndex()];
      if (active) {
        event.preventDefault();
        openResult(active);
      }
    }
  };

  // Cmd+F focuses the inline search or opens the compact search popover.
  // The compact popover's portal holds focus outside the split scope; while open,
  // handleContentKeyDown re-selects the query there.
  const searchHotkey = registerHotkey({
    hotkey: 'cmd+f',
    scopeId: panel.splitHotkeyScope,
    hotkeyToken: TOKENS.calendar.search,
    description: 'Search events',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (props.inline) {
        if (props.expanded === false) props.onExpand?.();
        else {
          focusInput();
          setOpen(true);
        }
      } else if (open()) focusInput();
      else setOpen(true);
      return true;
    },
  });
  onCleanup(searchHotkey.dispose);

  // The portal content lives outside the split hotkey scope, so a second Cmd+F
  // never reaches the split-scoped opener above — handle it here so it
  // re-selects the query instead of falling through to the browser find dialog.
  // Match the app's `cmd+f` semantics: the platform modifier (Cmd on Mac, not
  // Ctrl) and a case-insensitive key so Caps Lock still hits.
  const handleContentKeyDown = (event: KeyboardEvent) => {
    const cmdPressed = IS_MAC ? event.metaKey : event.ctrlKey;
    if (cmdPressed && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      // The input is unmounted while the preview shows, so go back to it first.
      if (previewTarget()) closePreview();
      else focusInput();
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setActiveRow(0);
          setPreviewTarget(null);
        }
      }}
      placement={props.inline ? 'bottom-start' : 'bottom-end'}
      gutter={6}
      flip
    >
      <Show
        when={props.inline}
        fallback={
          <Popover.Trigger
            as={Button}
            variant="ghost"
            size="icon-lg"
            class="rounded-full"
            aria-label="Search events"
          >
            <SearchIcon class="size-5 mobile:size-6" />
          </Popover.Trigger>
        }
      >
        <div class="min-w-0 max-w-md flex-1">
          <Popover.Anchor as="div" class="w-full">
            <SearchBar
              ref={(element) => (inputRef = element)}
              label="Search events"
              onClose={
                props.onDismiss
                  ? () => {
                      inputRef?.blur();
                      props.onDismiss?.();
                    }
                  : undefined
              }
              value={rawQuery()}
              onValueChange={changeQuery}
              actions={filterActions()}
              onClick={() => setOpen(true)}
              onFocus={() => setOpen(true)}
              onKeyDown={handleSearchKeyDown}
              onEscape={() => {
                setOpen(false);
                props.onDismiss?.();
              }}
              hotkey="cmd+f"
              placeholder="Search events"
            />
          </Popover.Anchor>
        </div>
      </Show>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-modal outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (!props.inline) inputRef?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (props.inline) event.preventDefault();
            }}
            onKeyDown={handleContentKeyDown}
            onInteractOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (
                target instanceof Element &&
                target.closest('[data-calendar-search-filters]')
              ) {
                event.preventDefault();
              }
              if (
                props.inline &&
                target instanceof Node &&
                inputRef?.closest('[data-search-bar]')?.contains(target)
              ) {
                event.preventDefault();
              }
            }}
          >
            <div
              class={cn(
                'max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl glass bg-menu-glass text-ink',
                props.inline ? 'w-[var(--kb-popper-anchor-width)]' : 'w-80'
              )}
            >
              <Show
                when={previewTarget()}
                fallback={
                  <>
                    <Show when={!props.inline}>
                      <div class="flex items-center gap-2 px-3 py-2">
                        <SearchIcon class="size-4 shrink-0 text-ink-muted" />
                        <input
                          ref={inputRef}
                          type="text"
                          value={rawQuery()}
                          onInput={(event) =>
                            changeQuery(event.currentTarget.value)
                          }
                          onKeyDown={handleSearchKeyDown}
                          placeholder="Search events"
                          class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                        />
                        {filterActions()}
                        <Show when={rawQuery()}>
                          <Button
                            type="button"
                            variant="plain"
                            size="icon-sm"
                            square
                            label="Clear search"
                            onClick={() => {
                              changeQuery('');
                              inputRef?.focus();
                            }}
                          >
                            <XIcon class="size-4" />
                          </Button>
                        </Show>
                      </div>
                    </Show>
                    <Show when={query().length < MIN_QUERY_LENGTH}>
                      <EmptyStatePanel
                        centered
                        graphic={EmptyStateCalendarSearchGraphic}
                        graphicClass="size-28 -mb-3"
                        title="Find an event"
                        titleClass="text-sm"
                        description="Type at least 3 characters to search events."
                        descriptionClass="mt-0.5 text-xs leading-5"
                        topSpacerClass="basis-0"
                        class="h-auto min-h-44 px-4 pb-4 pt-3 touch:pt-3 @4xl:px-4"
                      />
                    </Show>
                    <Show when={query().length >= MIN_QUERY_LENGTH}>
                      <div
                        ref={listRef}
                        class={cn(
                          'max-h-80 overflow-y-auto p-1',
                          !props.inline && 'border-t border-edge-muted'
                        )}
                      >
                        <Show
                          when={!isLoading()}
                          fallback={<CalendarSearchLoadingRows />}
                        >
                          <Show
                            when={results().length > 0}
                            fallback={
                              <EmptyStatePanel
                                centered
                                graphic={EmptyStateCalendarSearchGraphic}
                                graphicClass="size-28 -mb-3"
                                title="No matching events"
                                titleClass="text-sm"
                                description={`No calendar events found for “${query()}”.`}
                                descriptionClass="mt-0.5 text-xs leading-5"
                                topSpacerClass="basis-0"
                                class="h-auto min-h-44 px-4 pb-4 pt-3 touch:pt-3 @4xl:px-4"
                              />
                            }
                          >
                            <For each={results()}>
                              {(event, index) => (
                                <div
                                  data-result-index={index()}
                                  class={cn(
                                    'flex w-full items-center gap-1.5 rounded-lg p-1.5 px-2',
                                    index() === activeIndex() && 'bg-ink/5'
                                  )}
                                  onMouseMove={() => setActiveRow(index())}
                                >
                                  <button
                                    type="button"
                                    class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                                    onClick={() => openResult(event)}
                                  >
                                    <span class="flex min-w-0 items-center gap-1.5">
                                      <span
                                        aria-hidden="true"
                                        class="size-2.5 shrink-0 rounded-sm"
                                        style={{
                                          'background-color': colorForEvent(event.id),
                                        }}
                                      />
                                      <span class="min-w-0 truncate text-sm text-ink">
                                        {event.name || 'Untitled event'}
                                      </span>
                                    </span>
                                    <Show when={subtitleForEvent(event)}>
                                      {(label) => (
                                        <span class="block truncate pl-4 text-xs text-ink-muted">
                                          {label()}
                                        </span>
                                      )}
                                    </Show>
                                  </button>
                                  <Show
                                    when={meetingLinkForEvent(
                                      event,
                                      detailsForEvent(event)
                                    )}
                                  >
                                    {(link) => (
                                      <Button
                                        type="button"
                                        variant="plain"
                                        size="sm"
                                        label={`Join ${link().label}`}
                                        class={cn(
                                          'rounded-full px-2',
                                          link().kind === 'google'
                                            ? 'bg-blue text-[white] light-mode:not-touch:not-disabled:hover:text-[white] dark-mode:bg-blue-bg dark-mode:text-blue-ink dark-mode:not-touch:not-disabled:hover:bg-blue-hover dark-mode:not-touch:not-disabled:hover:text-blue-ink'
                                            : 'bg-hover text-ink not-touch:not-disabled:hover:bg-active not-touch:not-disabled:hover:text-ink'
                                        )}
                                        onClick={() => openExternalUrl(link().url)}
                                      >
                                        <VideoCameraIcon class="size-3.5" />
                                        {link().kind === 'macro'
                                          ? 'Macro'
                                          : link().kind === 'google'
                                            ? 'Meet'
                                            : 'Join'}
                                      </Button>
                                    )}
                                  </Show>
                                </div>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </>
                }
              >
                {(event) => (
                  <CalendarEventPreviewContent
                    event={event()}
                    color={colorForEvent(event().id)}
                    location={locationForEvent(event())}
                    timeFormat={calendarView.displaySettings.timeFormat}
                    onBack={closePreview}
                  />
                )}
              </Show>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
