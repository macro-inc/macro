import { SearchBar } from '@app/components/view-shell';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { DEFAULT_CALENDAR_SOURCE } from '@app/features/calendar/types';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import {
  conferenceJoinUrl,
  safeConferenceUrl,
} from '@app/features/calendar/utils/conference-link';
import {
  calendarMacroCallUrl,
  macroCallUrl,
} from '@app/features/calendar/utils/macro-call-link';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { IS_MAC } from '@core/constant/isMac';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import EmptyStateCalendarSearchGraphic from '@design/empty-state-calendar-search.svg';
import type { EntityData, WithSearch } from '@entity';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import QuotesIcon from '@icon/system/regular/quotes.svg';
import VideoCameraIcon from '@icon/system/regular/video-camera.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import { useCalendarSearchPreviewsQuery } from '@queries/calendar/mention-preview';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { useSearchSoupQuery } from '@queries/soup/search';
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
import { Portal } from 'solid-js/web';
import { CALENDAR_ONLY_SEARCH_FILTERS } from '../calendar-only-search-filters';
import { createCalendarRange } from '../calendar-range';
import {
  eventTimeFromOccurrenceKey,
  openCalendarEventSplit,
} from '../open-calendar-event';
import {
  CalendarSearchFilters,
  DEFAULT_CALENDAR_SEARCH_FILTERS,
} from './CalendarSearchFilters';
import {
  CalendarEventPreviewContent,
  CalendarSearchLoadingRows,
  formatEventWhen,
} from './search/calendar-search-preview';

type CalendarSearchResult = WithSearch<
  Extract<EntityData, { type: 'calendar_event' }>
>;

const searchEventKey = (eventId: string, occurrenceKey?: string) =>
  JSON.stringify([eventId, occurrenceKey ?? null]);

type CalendarMeetingLink = {
  url: string;
  kind: 'macro' | 'google' | 'other';
  label: string;
};

type CalendarSearchEventDetails = {
  conferenceUrl?: string;
  accountEmail?: string;
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
    details?.description ?? (event.isRecurring ? undefined : event.description);
  const macro = calendarMacroCallUrl({
    description,
    location: details?.location,
  });
  if (macro) return { url: macro, kind: 'macro', label: 'Macro call' };

  const googleContent =
    googleMeetUrlInText(details?.location) ?? googleMeetUrlInText(description);
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

/**
 * Keyword search over the caller's calendar events, opened from the calendar
 * header. Selecting a result re-aims the singleton Calendar view at that
 * occurrence, the same navigation an event mention or soup row performs.
 */
export function CalendarSearch(
  props: {
    page?: boolean;
    headerMount?: HTMLElement;
    inline?: boolean;
    compact?: boolean;
    expanded?: boolean;
    popupReady?: boolean;
    onExpand?: () => void;
    onDismiss?: () => void;
    onOpenChange?: (open: boolean) => void;
  } = {}
) {
  const searchEnabled = useCalendarSearchUiFlag();
  return (
    <Show when={searchEnabled()}>
      <CalendarSearchControl
        page={props.page}
        headerMount={props.headerMount}
        inline={props.inline}
        compact={props.compact}
        expanded={props.expanded}
        popupReady={props.popupReady}
        onExpand={props.onExpand}
        onDismiss={props.onDismiss}
        onOpenChange={props.onOpenChange}
      />
    </Show>
  );
}

function CalendarSearchControl(props: {
  page?: boolean;
  headerMount?: HTMLElement;
  inline?: boolean;
  compact?: boolean;
  expanded?: boolean;
  popupReady?: boolean;
  onExpand?: () => void;
  onDismiss?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const calendarView = useCalendarView();
  // The standalone page has no visible grid; preview requests supply metadata.
  const navigation = props.page ? undefined : useCalendarNavigation();
  const panel = useSplitPanelOrThrow();
  const [open, setOpenInternal] = createSignal(!!props.page);
  const setOpen = (next: boolean) => {
    setOpenInternal(next);
    props.onOpenChange?.(next);
    if (!next) {
      setActiveRow(0);
      setPreviewTarget(null);
      props.onDismiss?.();
    }
  };
  const [rawQuery, setRawQuery] = createSignal('');
  const [filters, setFilters] = createSignal(DEFAULT_CALENDAR_SEARCH_FILTERS);
  let inputRef: HTMLInputElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  const dismissSearch = () => {
    inputRef?.blur();
    setOpen(false);
    if (props.onDismiss) queueMicrotask(() => searchButton?.focus());
  };
  let listRef: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal(0);
  // Set to the chosen result when it falls outside the navigable range: the
  // popover then floats a read-only preview of it in place of the search body.
  const [previewTarget, setPreviewTarget] =
    createSignal<CalendarSearchResult | null>(null);

  const query = createMemo(() => rawQuery().trim());
  onMount(() => {
    if (props.page) inputRef?.focus();
  });
  const popupVisible = () =>
    props.popupReady !== false && (!props.inline || query().length > 0);
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
            ...CALENDAR_ONLY_SEARCH_FILTERS,
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
  usePending(
    'calendar.search.results',
    () => open() && isLoading() && !searchQuery.isError
  );

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

  const visibleOccurrences = useCalendarOccurrenceData({
    range: () => {
      const range = navigation?.visibleRange();
      return range
        ? createCalendarOccurrenceQueryRange(range.start, range.end)
        : undefined;
    },
    sourceById: calendarView.sourceById,
    sourcesReady: calendarView.sourcesReady,
    isSourceVisible: calendarView.isSourceVisible,
    queryOptions: () => ({ enabled: open(), pollWhileSyncing: false }),
  });

  // Search results have no calendar IDs. Match loaded occurrences for colors
  // and full instance content while the batched preview request resolves.
  const activeEventDetails = createMemo(() => {
    const byId = new Map<string, { color: string; location?: string }>();
    const byOccurrence = new Map<string, CalendarSearchEventDetails>();
    const data = visibleOccurrences;
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
        accountEmail: event.calendar.emailAddress,
        description: event.description,
        location: event.location,
      });
    }
    return { byId, byOccurrence };
  });
  const colorForEvent = (eventId: string) =>
    activeEventDetails().byId.get(eventId)?.color ??
    DEFAULT_CALENDAR_SOURCE.color;
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
      fireAndForget(
        openCalendarEventSplit({
          eventId: event.id,
          occurrenceKey: event.occurrenceKey,
          time: event.occurrenceKey ? undefined : event.time,
        }),
        'calendar-view'
      );
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
            aria-label={t('calendar.searchExact')}
            tooltip={t('calendar.searchExact')}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={filters().matchType === 'exact'}
            class={filters().matchType === 'exact' ? 'bg-active text-ink' : ''}
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
    description: () => t('calendar.searchEvents'),
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

  const resultsBody = () => (
    <>
      <Show
        when={previewTarget()}
        fallback={
          <>
            <Show when={!props.inline && !props.page}>
              <div class="flex items-center gap-2 px-3 py-2">
                <SearchIcon class="size-4 shrink-0 text-ink-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={rawQuery()}
                  onInput={(event) => changeQuery(event.currentTarget.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t('calendar.searchEvents')}
                  class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                />
                {filterActions()}
                <Show when={rawQuery()}>
                  <Button
                    aria-label={t('calendar.searchClear')}
                    tooltip={t('calendar.searchClear')}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
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
                title={t('calendar.searchFind')}
                titleClass="text-sm"
                description={t('calendar.searchHint')}
                descriptionClass="mt-0.5 text-xs leading-5"
                topSpacerClass="basis-0"
                class="h-auto min-h-44 px-4 pb-4 pt-3 touch:pt-3 @4xl:px-4"
              />
            </Show>
            <Show when={query().length >= MIN_QUERY_LENGTH}>
              <div
                ref={listRef}
                class={cn(
                  props.page
                    ? 'min-h-0 flex-1 overflow-y-auto p-2'
                    : 'max-h-80 overflow-y-auto p-1',
                  !props.page && !props.inline && 'border-t border-edge-muted'
                )}
              >
                <Show
                  when={!searchQuery.isError}
                  fallback={
                    <p role="alert" class="p-4">
                      {t('calendar.searchFailed')}{' '}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          fireAndForget(
                            searchQuery.refetch(),
                            'calendar-search'
                          )
                        }
                      >
                        {t('calendar.retry')}
                      </Button>
                    </p>
                  }
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
                          title={t('calendar.searchEmpty')}
                          titleClass="text-sm"
                          description={t('calendar.searchNoResults', {
                            query: query(),
                          })}
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
                              'flex w-full items-center gap-1.5 rounded-lg',
                              props.page
                                ? 'min-h-16 border-b border-edge-muted px-4 py-2'
                                : 'p-1.5 px-2',
                              !props.page &&
                                index() === activeIndex() &&
                                'bg-active'
                            )}
                            onMouseMove={() => setActiveRow(index())}
                          >
                            <button
                              type="button"
                              class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                              classList={{ 'min-h-11': props.page }}
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
                                  {event.name || t('calendar.searchUntitled')}
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
                                  aria-label={t('calendar.searchJoin', {
                                    name: link().label,
                                  })}
                                  tooltip={t('calendar.searchJoin', {
                                    name: link().label,
                                  })}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  class={cn(
                                    'px-2',
                                    link().kind === 'google'
                                      ? 'bg-blue text-button-primary-ink light-mode:not-touch:not-disabled:hover:text-button-primary-ink dark-mode:bg-blue-bg dark-mode:text-blue-ink dark-mode:not-touch:not-disabled:hover:bg-blue-hover dark-mode:not-touch:not-disabled:hover:text-blue-ink'
                                      : 'bg-hover text-ink not-touch:not-disabled:hover:bg-active not-touch:not-disabled:hover:text-ink'
                                  )}
                                  onClick={() =>
                                    openExternalUrl(
                                      conferenceJoinUrl(
                                        link().url,
                                        detailsForEvent(event)?.accountEmail
                                      )
                                    )
                                  }
                                >
                                  <VideoCameraIcon class="size-3.5" />
                                  {link().kind === 'macro'
                                    ? 'Macro'
                                    : link().kind === 'google'
                                      ? 'Meet'
                                      : t('calendar.searchJoinAction')}
                                </Button>
                              )}
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
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
    </>
  );

  const pageField = () => (
    <Show when={!previewTarget()}>
      <div class="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 py-2">
        <SearchIcon class="size-5 shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          aria-label={t('calendar.searchEvents')}
          type="search"
          value={rawQuery()}
          onInput={(event) => changeQuery(event.currentTarget.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('calendar.searchEvents')}
          class="min-w-0 flex-1 rounded-sm bg-transparent text-base caret-accent outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-accent placeholder:text-ink-placeholder"
        />
        {filterActions()}
      </div>
    </Show>
  );
  if (props.page)
    return (
      <div class="flex min-h-0 flex-1 flex-col bg-page">
        <Show when={props.headerMount} fallback={pageField()}>
          {(mount) => <Portal mount={mount()}>{pageField()}</Portal>}
        </Show>
        {resultsBody()}
      </div>
    );

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
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
            aria-label={t('calendar.searchEvents')}
          >
            <SearchIcon class="size-5 mobile:size-6" />
          </Popover.Trigger>
        }
      >
        <div class="relative h-[var(--view-search-height,2.5rem)] min-w-0 w-full flex-1">
          <Popover.Anchor
            as="div"
            class="h-[var(--view-search-height,2.5rem)] w-full"
          >
            <Show when={props.expanded === false}>
              <Button
                aria-label={t('calendar.searchEvents')}
                tooltip={{
                  content: t('calendar.searchEvents'),
                  hotkey: TOKENS.calendar.search,
                }}
                ref={searchButton}
                type="button"
                variant="secondary"
                size="icon-md"
                aria-expanded="false"
                aria-haspopup="dialog"
                onClick={props.onExpand}
              >
                <SearchIcon class="size-4" />
              </Button>
            </Show>
            {/* Keep the input mounted while its width animates; inert removes collapsed controls from keyboard navigation. */}
            <div
              aria-hidden={props.expanded === false}
              inert={props.expanded === false}
              class="absolute inset-x-0 top-0 overflow-hidden rounded-full transition-opacity duration-150 motion-reduce:transition-none"
              classList={{
                'pointer-events-none opacity-0': props.expanded === false,
              }}
            >
              <SearchBar
                ref={(element) => (inputRef = element)}
                label={t('calendar.searchEvents')}
                class="has-[input:focus-visible]:ring-inset"
                onClose={props.onDismiss ? dismissSearch : undefined}
                value={rawQuery()}
                onValueChange={changeQuery}
                actions={filterActions()}
                onClick={() => setOpen(true)}
                onFocus={() => setOpen(true)}
                onKeyDown={handleSearchKeyDown}
                onEscape={dismissSearch}
                hotkey="cmd+f"
                placeholder={t('common.search')}
              />
            </div>
          </Popover.Anchor>
        </div>
      </Show>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-modal outline-none transition-opacity duration-200 ease-out motion-reduce:transition-none"
            classList={{
              'pointer-events-none opacity-0': !popupVisible(),
            }}
            aria-hidden={!popupVisible() ? true : undefined}
            inert={!popupVisible()}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (!props.inline) inputRef?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (props.inline) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (!props.inline) return;
              event.preventDefault();
              dismissSearch();
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
              // The header dismisses after a period control's click. Collapsing
              // on pointerdown can move that control before mouseup and lose the click.
              if (
                props.inline &&
                target instanceof Element &&
                target.closest('[data-calendar-period-controls]') &&
                inputRef?.closest('[data-view-shell-top-bar]')?.contains(target)
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
                'menu-surface max-w-[calc(100vw-2rem)] overflow-hidden transition-[translate] duration-200 ease-out motion-reduce:transition-none',
                props.inline ? 'w-[var(--kb-popper-anchor-width)]' : 'w-80'
              )}
              classList={{
                '-translate-y-1': !popupVisible(),
              }}
            >
              {resultsBody()}
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
