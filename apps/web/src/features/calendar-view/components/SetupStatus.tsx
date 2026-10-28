import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';

const SETUP_MESSAGES = {
  connect: {
    title: 'Connect your calendar',
    description:
      'Connect a Google or Microsoft account to show your calendar events.',
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
    description: 'Reconnect your account to resume calendar sync.',
    action: 'Reconnect',
  },
} as const;

function isWorkingCalendar(link: EmailLink) {
  return (
    link.is_sync_active && !link.needs_calendar_permission && !link.needs_reauth
  );
}

/** Displays account setup actions above the complete calendar pager. */
export function SetupStatus() {
  const calendarPager = useCalendarPager();
  const linksQuery = useEmailLinksQuery();
  const calendarsQuery = useVisibleCalendarsQuery();
  const warnings = createMemo(() =>
    calendarsQuery.isSuccess
      ? calendarsQuery.data.filter((calendar) => calendar.syncError)
      : []
  );
  const startAddInbox = useAddInboxFlow();
  const userId = useUserId();

  // The links list also carries inboxes another Macro user delegated to the
  // viewer. Whether that user's calendar syncs is theirs to decide, as in the
  // calendar settings, so setup counts and acts on the viewer's own alone.
  const ownLinks = () =>
    linksQuery.isSuccess
      ? (linksQuery.data?.links ?? []).filter(
          (link) => link.macro_id === userId()
        )
      : [];

  const hasEvents = () =>
    (calendarPager.activeData()?.events().length ?? 0) > 0 ||
    calendarPager.activeTeamEvents().length > 0;

  // A working calendar shared with the viewer still fills the grid, so a week
  // without events is not a sign that nothing is set up: setting up their own
  // stays on offer without covering the grid.
  const seesWorkingCalendar = () =>
    linksQuery.isSuccess &&
    (linksQuery.data?.links ?? []).some(isWorkingCalendar);

  // Existing events are not evidence that setup is complete: a revoked grant
  // or delegated inbox can leave events visible without a working calendar
  // connection belonging to the current user.
  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | 'disabled' | undefined
  >(() => {
    const activeData = calendarPager.activeData();
    const range = activeData?.range();
    if (range && !isCalendarRangeSupported(range)) return undefined;

    if (
      !linksQuery.isSuccess ||
      !activeData?.occurrencesQuery.isSuccess ||
      userId() === undefined
    ) {
      return undefined;
    }

    const links = ownLinks();
    if (links.length === 0) return 'connect';

    if (links.some(isWorkingCalendar)) return undefined;
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
    const links = ownLinks();
    const link =
      state === 'reauth'
        ? links.find((link) => link.needs_reauth)
        : links.find((link) => link.needs_calendar_permission);
    fireAndForget(
      startAddInbox({
        provider: link?.provider,
        reconnectLinkId: link?.id,
        emailAddress: link?.email_address,
        scopes:
          state === 'permission' || state === 'disabled'
            ? 'calendar'
            : 'gmail_and_calendar',
      }),
      'add-inbox'
    );
  };

  return (
    <>
      <Show when={setupState() === undefined && warnings().length > 0}>
        <div
          role="status"
          class="absolute bottom-2 left-2 right-2 z-20 flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning-bg p-3 text-xs text-warning-ink"
        >
          <For each={warnings()}>
            {(calendar) => (
              <p>
                {calendar.emailAddress} — {calendar.name}: {calendar.syncError}
              </p>
            )}
          </For>
        </div>
      </Show>
      <Show when={setupState() !== undefined}>
        <Show
          when={!hasEvents() && !seesWorkingCalendar()}
          fallback={
            <div class="absolute right-2 bottom-2 z-20 flex items-center gap-2 rounded-full border border-edge-muted bg-surface py-1 pr-1 pl-2.5 text-xs text-ink-muted shadow-menu">
              <span>{setupMessage().title}</span>
              <Button variant="primary" size="sm" onClick={startSetup}>
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
              <Button variant="primary" size="sm" onClick={startSetup}>
                {setupMessage().action}
              </Button>
            </div>
          </div>
        </Show>
      </Show>
    </>
  );
}
