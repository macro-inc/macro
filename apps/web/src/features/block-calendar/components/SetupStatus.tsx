import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useAddInboxFlow } from '@core/email-link';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';

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
  disabled: {
    title: 'Calendar is off',
    description: 'Grant calendar access again to show your events in Macro.',
    action: 'Turn on',
  },
  reauth: {
    title: 'Reconnect calendar',
    description: 'Reconnect your Google account to resume calendar sync.',
    action: 'Reconnect',
  },
} as const;

/** Displays account setup actions above the complete calendar pager. */
export function SetupStatus() {
  const calendarPager = useCalendarPager();
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();

  const hasEvents = () =>
    (calendarPager.activeData()?.events().length ?? 0) > 0;

  // Existing events are not evidence that setup is complete: a revoked grant
  // or delegated inbox can leave events visible without a working calendar
  // connection belonging to the current user.
  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | 'disabled' | undefined
  >(() => {
    const activeData = calendarPager.activeData();
    const range = activeData?.range();
    if (range && !isCalendarRangeSupported(range)) return undefined;

    if (!linksQuery.isSuccess || !activeData?.occurrencesQuery.isSuccess) {
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
      // A calendar the user turned off is not a missing upgrade; say so, and
      // still offer the way back since they came to the calendar view.
      return links.every(
        (link) => !link.needs_calendar_permission || link.calendar_disabled
      )
        ? 'disabled'
        : 'permission';
    }

    return 'connect';
  });

  const setupMessage = createMemo(
    () => SETUP_MESSAGES[setupState() ?? 'connect']
  );

  // The permission and disabled states both sit on a working mailbox —
  // turning calendar off leaves Gmail untouched — so they ask for calendar
  // alone. Connecting and reconnecting need the mailbox scopes alongside it.
  const startSetup = () => {
    const state = setupState();
    void startAddInbox({
      scopes:
        state === 'permission' || state === 'disabled'
          ? 'calendar'
          : 'gmail_and_calendar',
    });
  };

  return (
    <Show when={setupState() !== undefined}>
      <Show
        when={!hasEvents()}
        fallback={
          <div class="absolute right-2 bottom-2 z-20 flex items-center gap-2 rounded-full border border-edge-muted bg-surface py-1 pr-1 pl-2.5 text-xs text-ink-muted shadow-menu">
            <span>{setupMessage().title}</span>
            <Button variant="accent" size="sm" onClick={startSetup}>
              {setupMessage().action}
            </Button>
          </div>
        }
      >
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <div class="flex max-w-sm flex-col items-center gap-3">
            <div class="text-sm font-semibold text-ink">
              {setupMessage().title}
            </div>
            <p class="text-xs text-ink-muted">{setupMessage().description}</p>
            <Button variant="accent" size="sm" onClick={startSetup}>
              {setupMessage().action}
            </Button>
          </div>
        </div>
      </Show>
    </Show>
  );
}
