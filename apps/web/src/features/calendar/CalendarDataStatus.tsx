import { useAddInboxFlow } from '@core/email-link';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useCalendarView } from './CalendarViewContext';
import { isCalendarRangeSupported } from './calendar-supported-range';

const SETUP_MESSAGES = {
  connect: {
    title: 'Connect your calendar',
    description: 'Connect a Google account to show your calendar events.',
    action: 'Connect calendar',
  },
  permission: {
    title: 'Enable calendar',
    description: 'Grant calendar access to show your events in Macro.',
    action: 'Grant access',
  },
  reauth: {
    title: 'Reconnect calendar',
    description: 'Reconnect your Google account to resume calendar sync.',
    action: 'Reconnect',
  },
} as const;

/** Displays setup, loading, sync, and retry states over the calendar host. */
export function CalendarDataStatus() {
  const calendarView = useCalendarView();
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();
  const isRangeUnavailable = createMemo(() => {
    const range = calendarView.visibleRange();
    return range !== undefined && !isCalendarRangeSupported(range);
  });

  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | undefined
  >(() => {
    if (
      isRangeUnavailable() ||
      !linksQuery.isSuccess ||
      !calendarView.occurrencesQuery.isSuccess ||
      calendarView.events().length > 0
    ) {
      return undefined;
    }

    const links = linksQuery.data?.links ?? [];
    if (links.length === 0) return 'connect';

    const hasAvailableCalendar = links.some(
      (link) =>
        link.is_sync_active &&
        !link.needs_calendar_permission &&
        !link.needs_reauth
    );
    if (hasAvailableCalendar) return undefined;
    if (links.some((link) => link.needs_reauth)) return 'reauth';
    if (links.some((link) => link.needs_calendar_permission)) {
      return 'permission';
    }

    return 'connect';
  });

  const setupMessage = createMemo(
    () => SETUP_MESSAGES[setupState() ?? 'connect']
  );

  const showLoading = () =>
    !isRangeUnavailable() &&
    (calendarView.isLoading() ||
      (calendarView.isSyncing() && calendarView.events().length === 0));
  const showBlockingState = () =>
    !isRangeUnavailable() &&
    (calendarView.occurrencesQuery.isError ||
      setupState() !== undefined ||
      showLoading());

  return (
    <>
      <Show when={showBlockingState()}>
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <Show
            when={!calendarView.occurrencesQuery.isError}
            fallback={
              <div class="flex max-w-sm flex-col items-center gap-3">
                <div class="text-sm font-semibold text-ink">
                  Calendar unavailable
                </div>
                <p class="text-xs text-ink-muted">
                  We couldn’t load your calendar events. Try again.
                </p>
                <Button
                  variant="active"
                  size="sm"
                  label="Retry loading calendar"
                  onClick={() => void calendarView.occurrencesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            }
          >
            <Show
              when={setupState() === undefined}
              fallback={
                <div class="flex max-w-sm flex-col items-center gap-3">
                  <div class="text-sm font-semibold text-ink">
                    {setupMessage().title}
                  </div>
                  <p class="text-xs text-ink-muted">
                    {setupMessage().description}
                  </p>
                  <Button
                    variant="active"
                    size="sm"
                    label={setupMessage().action}
                    onClick={() => void startAddInbox()}
                  >
                    {setupMessage().action}
                  </Button>
                </div>
              }
            >
              <div class="flex items-center gap-2 text-xs text-ink-muted">
                <SpinnerIcon class="size-4 animate-spin" />
                <span>
                  {calendarView.isSyncing()
                    ? 'Syncing calendar…'
                    : 'Loading calendar…'}
                </span>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      <Show
        when={
          !isRangeUnavailable() &&
          !showBlockingState() &&
          calendarView.isSyncing() &&
          calendarView.events().length > 0
        }
      >
        <div class="absolute right-2 bottom-2 z-10 flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs text-ink-muted shadow-menu">
          <SpinnerIcon class="size-3 animate-spin" />
          Syncing
        </div>
      </Show>
    </>
  );
}
