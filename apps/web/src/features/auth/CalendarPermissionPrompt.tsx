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
 * Inboxes that also need a full reconnect are skipped: the reconnect prompt
 * covers them, and reconnecting records the calendar grant anyway.
 *
 * Gated per form factor: `enable-calendar-prompt-web` on desktop/web and
 * `enable-calendar-prompt-mobile` on phones, where the toast layout can't
 * present it without stranding the user. See `useCalendarPromptAllowed`.
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
            (link) => link.needs_calendar_permission && !link.needs_reauth
          )
        : [],
    key: (link) => link.id,
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
            startAddInbox({ includeCalendar: true });
          },
        },
      ],
    }),
  });

  return null;
}
