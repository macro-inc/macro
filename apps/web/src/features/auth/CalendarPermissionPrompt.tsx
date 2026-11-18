import { t } from '@app/lib/i18n';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { calendarStoppedSyncing } from '@core/email-link/consent';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import { useEmailLinksQuery } from '@queries/email/link';

/**
 * Surfaces a per-inbox "Enable calendar" prompt for every linked inbox whose
 * Google grant predates the calendar scope (or declined it), driven by
 * `needs_calendar_permission` from the links list. Re-running the connect flow
 * re-shows Google consent for the linked account and applies the upgraded
 * grant to the existing link, which kicks off the calendar backfill.
 *
 * Only the viewer's own inboxes are prompted. The links list also carries
 * inboxes another Macro user delegated to the viewer; whether that user's
 * calendar syncs is theirs to decide, as in the calendar settings.
 *
 * Inboxes that also need a full reconnect are skipped so the two prompts don't
 * stack. Reconnecting restores previously enabled calendar access too; an
 * inbox that never enabled calendar can still opt in through this prompt.
 * Inboxes whose calendar the user turned off are also skipped — that reads as
 * missing calendar permission too, and nagging someone to re-enable what they
 * just removed is the one thing this prompt must never do.
 *
 * An inbox whose calendar used to sync and lost its capability
 * ({@link calendarStoppedSyncing}) is asked to reconnect instead, under its own
 * dismissal, since its events are gone.
 *
 * Closing the prompt sticks across reloads. Nothing is broken while calendar
 * is off, so re-asking every load is just nagging — Settings › Email keeps a
 * per-inbox "Enable calendar" button for whenever the user wants it.
 */
export function CalendarPermissionPrompt() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  const startAddInbox = useAddInboxFlow();

  useKeyedPersistentToasts({
    items: () =>
      (linksQuery.isSuccess ? linksQuery.data.links : []).filter(
        (link) =>
          link.macro_id === userId() &&
          link.needs_calendar_permission &&
          !link.needs_reauth &&
          !link.calendar_disabled
      ),
    // A calendar that stopped syncing is a new ask: an "Enable calendar"
    // dismissed months ago must not hide it.
    key: (link) =>
      calendarStoppedSyncing(link) ? `stopped:${link.id}` : link.id,
    persistKey: 'macro:calendar-prompt:dismissed',
    // Until the links and the viewer's id resolve, the empty list
    // above means "don't know yet", not "no inbox needs this" — stored
    // dismissals must survive that window.
    itemsLoaded: () => linksQuery.isSuccess && userId() !== undefined,
    toast: (link, dismiss) => ({
      title: calendarStoppedSyncing(link)
        ? t('calendarPrompt.stoppedTitle')
        : t('calendarPrompt.enableTitle'),
      icon: CalendarIcon,
      color: 'var(--color-accent)',
      dismissLabel: t('common.notNow'),
      content(): string {
        return calendarStoppedSyncing(link)
          ? t('calendarPrompt.stoppedContent', { email: link.email_address })
          : t('calendarPrompt.enableContent', { email: link.email_address });
      },
      actions: [
        {
          label: calendarStoppedSyncing(link)
            ? t('calendarPrompt.stoppedAction')
            : t('calendarPrompt.enableAction'),
          onClick: () => {
            // Suppress re-prompting until the grant upgrades; on native the
            // page stays mounted while the OAuth flow runs.
            dismiss();
            fireAndForget(
              startAddInbox({
                scopes: 'calendar',
                provider: link.provider,
                reconnectLinkId: link.id,
                emailAddress: link.email_address,
              }),
              'add-inbox'
            );
          },
        },
      ],
    }),
  });

  return null;
}
