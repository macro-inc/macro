import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import type { CalendarTimeFormat } from '@app/features/calendar/types';
import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import { formatCalendarTime } from '@app/features/calendar/utils/time-format';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { debouncedDependent } from '@core/util/debounce';
import type { EntityData, WithSearch } from '@entity';
import SearchIcon from '@icon/macro-magnifying-glass.svg';
import { Popover } from '@kobalte/core/popover';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { EntityFilters } from '@service-search/generated/models';
import { Button, cn, Layer } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { openCalendarEventSplit } from '../open-calendar-event';

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
 * Keyword search over the caller's calendar events, opened from the calendar
 * header. Selecting a result re-aims the singleton calendar block at that
 * occurrence, the same navigation an event mention or soup row performs.
 */
export function CalendarSearch() {
  const searchEnabled = useCalendarSearchUiFlag();
  return (
    <Show when={searchEnabled()}>
      <CalendarSearchControl />
    </Show>
  );
}

function CalendarSearchControl() {
  const calendarView = useCalendarView();
  const panel = useSplitPanelOrThrow();
  const [open, setOpen] = createSignal(false);
  const [rawQuery, setRawQuery] = createSignal('');
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal(0);

  const query = createMemo(() => rawQuery().trim());
  const debouncedQuery = debouncedDependent(query, 250);

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 25 },
      body: {
        search_on: 'name_content',
        match_type: 'partial',
        query: debouncedQuery(),
        filters: CALENDAR_ONLY_FILTERS,
      },
    }),
    () => ({ enabled: open() })
  );

  // Trust the results only once the debounce has caught up to what the user
  // typed AND the fetch for it has settled. Otherwise, for up to the debounce
  // interval after a keystroke, `searchQuery.data` still holds the previous
  // query's rows — which would show stale hits and let Enter open the old
  // first event. Mirrors the soup search's `isSearchServiceDebounceSettled`.
  const isCurrent = () =>
    query().length >= MIN_QUERY_LENGTH &&
    query() === debouncedQuery() &&
    !(searchQuery.isFetching && !searchQuery.isFetchingNextPage);

  const results = createMemo<CalendarSearchResult[]>(() => {
    if (!isCurrent()) return [];
    return (searchQuery.data ?? []).filter(
      (entity): entity is CalendarSearchResult =>
        entity.type === 'calendar_event'
    );
  });

  const isLoading = () => query().length >= MIN_QUERY_LENGTH && !isCurrent();

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
    setOpen(false);
    setRawQuery('');
    // An occurrence key anchors the locator range on its own; without one the
    // master span stands in (a series with no occurrence in the window).
    void openCalendarEventSplit({
      eventId: event.id,
      occurrenceKey: event.occurrenceKey,
      time: event.occurrenceKey ? undefined : event.time,
    });
  };

  // Cmd+F opens the search, matching the channel block's find-bar. Registered
  // only while this control is mounted, which the calendar-search flag gates.
  const searchHotkey = registerHotkey({
    hotkey: 'cmd+f',
    scopeId: panel.splitHotkeyScope,
    hotkeyToken: TOKENS.calendar.search,
    description: 'Search events',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (open()) {
        inputRef?.focus();
        inputRef?.select();
      } else {
        setOpen(true);
      }
      return true;
    },
  });
  onCleanup(searchHotkey.dispose);

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setRawQuery('');
          setActiveRow(0);
        }
      }}
      placement="bottom-end"
      gutter={6}
      flip
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        class="rounded-lg"
        aria-label="Search events"
      >
        <SearchIcon class="size-4" />
      </Popover.Trigger>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-modal outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef?.focus();
            }}
          >
            <div class="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-surface text-ink shadow-menu ring ring-edge-muted">
              <div class="flex items-center gap-2 px-3 py-2">
                <SearchIcon class="size-4 shrink-0 text-ink-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={rawQuery()}
                  onInput={(event) => {
                    setRawQuery(event.currentTarget.value);
                    setActiveRow(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveActive(1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveActive(-1);
                    } else if (event.key === 'Enter') {
                      const active = results()[activeIndex()];
                      if (active) openResult(active);
                    }
                  }}
                  placeholder="Search by event name"
                  class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                />
              </div>

              <Show when={query().length >= MIN_QUERY_LENGTH}>
                <div
                  ref={listRef}
                  class="max-h-80 overflow-y-auto border-t border-edge-muted p-1"
                >
                  <Show
                    when={!isLoading()}
                    fallback={
                      <div class="px-2 py-3 text-center text-xs text-ink-muted">
                        Searching…
                      </div>
                    }
                  >
                    <Show
                      when={results().length > 0}
                      fallback={
                        <div class="px-2 py-3 text-center text-xs text-ink-muted">
                          No events found
                        </div>
                      }
                    >
                      <For each={results()}>
                        {(event, index) => (
                          <button
                            type="button"
                            data-result-index={index()}
                            class={cn(
                              'flex w-full items-center gap-2 rounded-lg p-1.5 px-2 text-left outline-none',
                              index() === activeIndex() && 'bg-ink/5'
                            )}
                            onMouseEnter={() => setActiveRow(index())}
                            onClick={() => openResult(event)}
                          >
                            <span class="flex size-4 shrink-0 items-center justify-center">
                              <EntityIcon
                                targetType="calendar"
                                size="xs"
                                theme="monochrome"
                              />
                            </span>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate text-sm text-ink">
                                {event.name || 'Untitled event'}
                              </span>
                              <Show
                                when={formatEventWhen(
                                  event.time,
                                  calendarView.displaySettings.timeFormat
                                )}
                              >
                                {(label) => (
                                  <span class="block truncate text-xs text-ink-muted">
                                    {label()}
                                  </span>
                                )}
                              </Show>
                            </span>
                          </button>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </Show>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
