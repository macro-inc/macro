import { useAddInboxFlow } from '@core/email-link';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import { useCalendarPager } from './CalendarPagerContext';
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

/** Displays account setup actions above the complete calendar pager. */
export function CalendarSetupStatus() {
  const calendarPager = useCalendarPager();
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();

  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | undefined
  >(() => {
    const activeData = calendarPager.activeData();
    const range = activeData?.range();
    if (range && !isCalendarRangeSupported(range)) return undefined;

    if (
      !linksQuery.isSuccess ||
      !activeData?.occurrencesQuery.isSuccess ||
      activeData.events().length > 0
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

  return (
    <Show when={setupState() !== undefined}>
      <div
        class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
        aria-live="polite"
      >
        <div class="flex max-w-sm flex-col items-center gap-3">
          <div class="text-sm font-semibold text-ink">
            {setupMessage().title}
          </div>
          <p class="text-xs text-ink-muted">{setupMessage().description}</p>
          <Button
            variant="active"
            size="sm"
            label={setupMessage().action}
            onClick={() => void startAddInbox()}
          >
            {setupMessage().action}
          </Button>
        </div>
      </div>
    </Show>
  );
}
