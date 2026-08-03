import { useCalendarUiFlag } from '@app/features/calendar/use-calendar-ui-flag';
import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow } from '@core/email-link';
import { useEmailLinksQuery } from '@queries/email/link';
import { createEffect, onCleanup } from 'solid-js';

/**
 * Surfaces a per-inbox "Enable calendar" prompt for every linked inbox whose
 * Google grant predates the calendar scope (or declined it), driven by
 * `needs_calendar_permission` from the links list. Re-running the connect flow
 * re-shows Google consent for the linked account and applies the upgraded
 * grant to the existing link, which kicks off the calendar backfill.
 *
 * Inboxes that also need a full reconnect are skipped: the reconnect prompt
 * covers them, and reconnecting records the calendar grant anyway.
 */
export function CalendarPermissionPrompt() {
  const calendarUiEnabled = useCalendarUiFlag();
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();

  // One persistent toast per inbox, keyed by link id.
  const toastIds = new Map<string, number>();
  // Inboxes the user dismissed this session; not re-prompted until they upgrade.
  const dismissed = new Set<string>();

  const dismissToast = (linkId: string) => {
    const id = toastIds.get(linkId);
    if (id !== undefined) {
      toast.dismiss(id);
      toastIds.delete(linkId);
    }
  };

  createEffect(() => {
    if (!calendarUiEnabled()) {
      for (const linkId of [...toastIds.keys()]) dismissToast(linkId);
      return;
    }

    const links = linksQuery.data?.links ?? [];
    const needingCalendar = new Set(
      links
        .filter((link) => link.needs_calendar_permission && !link.needs_reauth)
        .map((link) => link.id)
    );

    // Clear toasts and dismissals for inboxes that upgraded or were removed,
    // so a later downgrade can prompt again.
    for (const linkId of [...toastIds.keys()]) {
      if (!needingCalendar.has(linkId)) dismissToast(linkId);
    }
    for (const linkId of [...dismissed]) {
      if (!needingCalendar.has(linkId)) dismissed.delete(linkId);
    }

    for (const link of links) {
      if (
        !needingCalendar.has(link.id) ||
        toastIds.has(link.id) ||
        dismissed.has(link.id)
      ) {
        continue;
      }

      const linkId = link.id;
      const id = toast.custom(
        {
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
                dismissed.add(linkId);
                dismissToast(linkId);
                startAddInbox();
              },
            },
          ],
        },
        {
          persistent: true,
          onDismiss: () => {
            toastIds.delete(linkId);
            dismissed.add(linkId);
          },
        }
      );
      toastIds.set(linkId, id);
    }
  });

  onCleanup(() => {
    for (const linkId of [...toastIds.keys()]) dismissToast(linkId);
  });

  return null;
}
