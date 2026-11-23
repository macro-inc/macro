import type { CalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { calendarStoppedSyncing } from '@core/email-link/consent';
import { fireAndForget } from '@core/util/fireAndForget';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { Button, cn } from '@ui';
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
  stopped: {
    title: 'Calendar stopped syncing',
    description: 'Reconnect to show its events in Macro again.',
    action: 'Reconnect',
  },
} as const;

function isWorkingCalendar(link: EmailLink) {
  return (
    link.is_sync_active && !link.needs_calendar_permission && !link.needs_reauth
  );
}

type SetupCalendarData = Pick<CalendarOccurrenceData, 'range' | 'events'> & {
  occurrencesQuery: { isSuccess: boolean };
};
type SetupProps = {
  data: SetupCalendarData | undefined;
  hasOverlayEvents?: boolean;
  /** A partial window cannot prove that the whole viewport is empty. */
  allowBlocking?: boolean;
};

/** The setup the viewer's own inboxes need before their calendar shows. */
function useCalendarSetup(props: SetupProps) {
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
    (props.data?.events().length ?? 0) > 0 || props.hasOverlayEvents === true;

  // A working calendar shared with the viewer still fills the grid, so a week
  // without events is not a sign that nothing is set up: setting up their own
  // stays on offer without covering the grid.
  const seesWorkingCalendar = () =>
    linksQuery.isSuccess &&
    (linksQuery.data?.links ?? []).some(isWorkingCalendar);

  // Existing events are not evidence that setup is complete: a revoked grant
  // or delegated inbox can leave events visible without a working calendar
  // connection belonging to the current user.
  const stoppedLink = () => ownLinks().find(calendarStoppedSyncing);

  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | 'disabled' | 'stopped' | undefined
  >(() => {
    const activeData = props.data;
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

    if (links.some(calendarStoppedSyncing)) return 'stopped';
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
  // A stopped calendar beside working ones keeps to the banner above the grid,
  // so the working calendars' sync errors still show.
  const showsWarnings = () =>
    setupState() === undefined ||
    (setupState() === 'stopped' && (hasEvents() || seesWorkingCalendar()));
  const setupTitle = () => {
    const stopped = setupState() === 'stopped' ? stoppedLink() : undefined;
    return stopped
      ? `Calendar for ${stopped.email_address} stopped syncing`
      : setupMessage().title;
  };

  // The permission and disabled states both sit on a working mailbox —
  // turning calendar off leaves Gmail untouched — so they ask for calendar
  // alone. Connecting and reconnecting need the mailbox scopes alongside it.
  const startSetup = () => {
    const state = setupState();
    const links = ownLinks();
    const link =
      state === 'reauth'
        ? links.find((link) => link.needs_reauth)
        : state === 'stopped'
          ? stoppedLink()
          : links.find((link) => link.needs_calendar_permission);
    fireAndForget(
      startAddInbox({
        provider: link?.provider,
        reconnectLinkId: link?.id,
        emailAddress: link?.email_address,
        scopes:
          state === 'permission' || state === 'disabled' || state === 'stopped'
            ? 'calendar'
            : 'gmail_and_calendar',
      }),
      'add-inbox'
    );
  };

  // Over an empty grid the setup explains itself in place of the events;
  // beside events, or a calendar shared with the viewer, it sits above the
  // grid, where it covers none of them.
  const coversGrid = () =>
    props.allowBlocking !== false &&
    setupState() !== undefined &&
    !hasEvents() &&
    !seesWorkingCalendar();
  const besideGrid = () => setupState() !== undefined && !coversGrid();

  return {
    warnings,
    showsWarnings,
    setupTitle,
    setupMessage,
    startSetup,
    coversGrid,
    besideGrid,
  };
}

/** Explains missing setup over an empty grid, and lists calendars' sync errors. */
export function SetupStatus(props: SetupProps) {
  const setup = useCalendarSetup(props);
  return (
    <>
      <Show when={props.allowBlocking === false}>
        <SetupBanner {...props} />
      </Show>
      <Show when={setup.showsWarnings() && setup.warnings().length > 0}>
        <div
          role="status"
          class="absolute bottom-2 left-2 right-2 z-20 flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning-bg p-3 text-xs text-warning-ink"
        >
          <For each={setup.warnings()}>
            {(calendar) => (
              <p>
                {calendar.emailAddress} — {calendar.name}: {calendar.syncError}
              </p>
            )}
          </For>
        </div>
      </Show>
      <Show when={setup.coversGrid()}>
        <div
          class="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/90 p-6 text-center"
          aria-live="polite"
        >
          <div class="flex max-w-sm flex-col items-center gap-3">
            <div class="text-sm font-semibold text-ink">
              {setup.setupTitle()}
            </div>
            <p class="text-xs text-ink-muted">
              {setup.setupMessage().description}
            </p>
            <Button variant="primary" size="sm" onClick={setup.startSetup}>
              {setup.setupMessage().action}
            </Button>
          </div>
        </div>
      </Show>
    </>
  );
}

/** Offers missing setup above a grid that shows events, in the page's flow. */
export function SetupBanner(
  props: SetupProps & { class?: string; fullWidth?: boolean }
) {
  const setup = useCalendarSetup(props);
  return (
    <Show when={setup.besideGrid()}>
      <div class={cn('shrink-0', props.class)}>
        <div
          role="status"
          class={cn(
            'mb-2 flex items-center gap-3 border border-accent bg-accent-bg px-3 py-2 text-xs',
            props.fullWidth ? 'rounded-none' : 'mx-2 rounded-lg'
          )}
        >
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="font-medium text-ink">{setup.setupTitle()}</span>
            <span class="text-ink-muted">
              {setup.setupMessage().description}
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            class="shrink-0"
            onClick={setup.startSetup}
          >
            {setup.setupMessage().action}
          </Button>
        </div>
      </div>
    </Show>
  );
}
