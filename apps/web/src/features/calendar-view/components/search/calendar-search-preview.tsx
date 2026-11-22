import type { CalendarTimeFormat } from '@app/features/calendar/types';
import { formatCalendarTime } from '@app/features/calendar/utils/time-format';
import { formatLocale, t } from '@app/lib/i18n';
import { parseLocalDate } from '@core/util/local-date';
import type { EntityData, WithSearch } from '@entity';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import { useCalendarMentionPreviewQuery } from '@queries/calendar/mention-preview';
import { cn } from '@ui';
import { For, onMount, Show } from 'solid-js';

type CalendarSearchResult = WithSearch<
  Extract<EntityData, { type: 'calendar_event' }>
>;
type EventTime = NonNullable<CalendarSearchResult['time']>;
function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: 'numeric' }),
  }).format(date);
}

/** The date/time an event row resolved to, matching the calendar's clock. */
export function formatEventWhen(
  time: EventTime | undefined,
  timeFormat: CalendarTimeFormat
): string {
  if (!time) return '';
  if (time.kind === 'allDay') {
    const date = parseLocalDate(time.startDate);
    return date
      ? `${formatDateLabel(date)} · ${t('calendar.agendaAllDay')}`
      : '';
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
export function CalendarEventPreviewContent(props: {
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
    [
      formatEventWhen(props.event.time, props.timeFormat),
      props.location?.trim(),
    ]
      .filter(Boolean)
      .join(' · ');
  const organizer = () =>
    props.event.organizer?.name || props.event.organizer?.email || '';
  const detail = () => {
    if (previewQuery.isPending) return '';
    const preview = previewQuery.data;
    if (!preview) return '';
    return preview.attendeeCount > 0
      ? t('calendar.searchGuests', { count: preview.attendeeCount })
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
        {t('calendar.backToSearch')}
      </button>
      <div class="flex flex-col gap-1 px-2 pb-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            class="size-2.5 shrink-0 rounded-sm"
            style={{ 'background-color': props.color }}
          />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {props.event.name || t('calendar.searchUntitled')}
          </span>
          <Show when={props.event.isRecurring}>
            <RepeatIcon
              aria-hidden={false}
              class="size-3 shrink-0 text-ink-muted"
              aria-label={t('calendar.searchRepeats')}
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
          {t('calendar.searchOutsideRange')}
        </span>
      </div>
    </div>
  );
}

export function CalendarSearchLoadingRows() {
  return (
    <div role="status">
      <span class="sr-only">{t('calendar.searchLoading')}</span>
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
