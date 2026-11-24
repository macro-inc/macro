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
    link.is_sync_active &&
    !link.calendar_disabled &&
    !link.needs_calendar_permission &&
    !link.needs_reauth
  );
}

type SetupCalendarData = Pick<CalendarOccurrenceData, 'range'>;
type SetupProps = {
  data: SetupCalendarData | undefined;
  /** Agenda places the shared banner before its list content. */
  includeBanner?: boolean;
  fullWidth?: boolean;
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

  // Delegated links belong to other users; the viewer cannot repair them,
  // but a working delegated calendar still counts as connected.
  const ownLinks = () =>
    linksQuery.isSuccess
      ? (linksQuery.data?.links ?? []).filter(
          (link) => link.macro_id === userId()
        )
      : [];

  // A working delegated calendar is connected for the viewer too, even though
  // only the owner can change its setup.
  const seesWorkingCalendar = () =>
    linksQuery.isSuccess &&
    (linksQuery.data?.links ?? []).some(isWorkingCalendar);

  // Old calendar data marks a revoked grant even after its events disappear.
  const stoppedLink = () => ownLinks().find(calendarStoppedSyncing);

  const setupState = createMemo<
    'connect' | 'permission' | 'reauth' | 'disabled' | 'stopped' | undefined
  >(() => {
    const activeData = props.data;
    const range = activeData?.range();
    if (range && !isCalendarRangeSupported(range)) return undefined;

    if (!linksQuery.isSuccess || userId() === undefined) return undefined;

    const links = ownLinks();
    if (links.length === 0) {
      return seesWorkingCalendar() ? undefined : 'connect';
    }

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

    return seesWorkingCalendar() ? undefined : 'connect';
  });

  const setupMessage = createMemo(
    () => SETUP_MESSAGES[setupState() ?? 'connect']
  );
  // A stopped calendar beside working ones keeps the sync errors visible.
  const showsWarnings = () =>
    setupState() === undefined || setupState() === 'stopped';
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

  // Setup sits in the flow above the grid, including when there are no events.
  const besideGrid = () => setupState() !== undefined;

  return {
    warnings,
    showsWarnings,
    setupTitle,
    setupMessage,
    startSetup,
    besideGrid,
  };
}

/** Lists calendars' sync errors and hosts Agenda's inline setup banner. */
export function SetupStatus(props: SetupProps) {
  const setup = useCalendarSetup(props);
  return (
    <>
      <Show when={props.includeBanner}>
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
    </>
  );
}

/** Offers missing setup above the grid without covering events or navigation. */
export function SetupBanner(props: SetupProps) {
  const setup = useCalendarSetup(props);
  return (
    <Show when={setup.besideGrid()}>
      <div class={props.includeBanner ? 'order-first shrink-0' : 'shrink-0'}>
        <div
          role="status"
          class={cn(
            'mb-2 flex gap-3 border border-accent bg-accent-bg px-3 py-2 text-xs',
            props.fullWidth
              ? 'mx-2 flex-col items-start rounded-(--calendar-phone-card-radius)'
              : 'mx-2 items-center rounded-lg'
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
            class={props.fullWidth ? 'self-start' : 'shrink-0'}
            onClick={setup.startSetup}
          >
            {setup.setupMessage().action}
          </Button>
        </div>
      </div>
    </Show>
  );
}
