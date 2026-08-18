import {
  useCalendarPromptAllowed,
  useCalendarUiFlag,
} from '@app/features/calendar/use-calendar-ui-flag';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { useAddInboxFlow } from '@core/email-link';
import { useEmailLinksQuery } from '@queries/email/link';

/**
 * Surfaces a per-inbox "Enable calendar" prompt for every linked inbox whose
 * Google grant predates the calendar scope (or declined it), driven by
 * `needs_calendar_permission` from the links list. Re-running the connect flow
 * re-shows Google consent for the linked account and applies the upgraded
 * grant to the existing link, which kicks off the calendar backfill.
 *
 * Inboxes that also need a full reconnect are skipped so the two prompts don't
 * stack. Reconnecting restores the mailbox without calendar access, which
 * leaves `needs_calendar_permission` set and brings this prompt back. So are
 * inboxes whose calendar the user turned off — that reads as missing calendar
 * permission too, and nagging someone to re-enable what they just removed is
 * the one thing this prompt must never do.
 *
 * Closing the prompt sticks across reloads. Nothing is broken while calendar
 * is off, so re-asking every load is just nagging — Settings › Email keeps a
 * per-inbox "Enable calendar" button for whenever the user wants it.
 */
export function CalendarPermissionPrompt() {
  const calendarUiEnabled = useCalendarUiFlag();
  const promptAllowed = useCalendarPromptAllowed();
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();

  useKeyedPersistentToasts({
    items: () =>
      calendarUiEnabled() && promptAllowed()
        ? (linksQuery.data?.links ?? []).filter(
            (link) =>
              link.needs_calendar_permission &&
              !link.needs_reauth &&
              !link.calendar_disabled
          )
        : [],
    key: (link) => link.id,
    persistKey: 'macro:calendar-prompt:dismissed',
    // Until the flag resolves and the links land, the empty list above means
    // "don't know yet", not "no inbox needs this" — stored dismissals must
    // survive that window.
    itemsLoaded: () => calendarUiEnabled() && linksQuery.isSuccess,
    toast: (link, dismiss) => ({
      title: 'Enable calendar',
      content(): string {
        return `Macro can now sync your Google Calendar. Grant calendar access for ${link.email_address} to turn it on.`;
      },
      actions: [
        {
          label: 'Grant access',
          onClick: () => {
            // Suppress re-prompting until the grant upgrades; on native the
            // page stays mounted while the OAuth flow runs.
            dismiss();
            startAddInbox({ scopes: 'calendar' });
          },
        },
      ],
    }),
  });

  return null;
}
