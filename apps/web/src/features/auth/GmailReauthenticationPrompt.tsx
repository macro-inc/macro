import { t } from '@app/lib/i18n';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { useAddInboxFlow } from '@core/email-link';
import { reconnectScopes } from '@core/email-link/consent';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import {
  useEmailLinksQuery,
  useInboxHealthProbeQuery,
} from '@queries/email/link';

/**
 * Surfaces a scope-specific reconnect prompt for every linked inbox whose grant
 * has died, driven by `needs_reauth` from the (already polled) links list. Because
 * the links list includes delegated/shared inboxes, a shared inbox's prompt fans
 * out to every sharer automatically. Replaces the old mount-once, primary-only
 * `/link/gmail/status` check.
 */
export function GmailReauthenticationPrompt() {
  const linksQuery = useEmailLinksQuery();
  const startAddInbox = useAddInboxFlow();

  // Probe inbox grants on mount and on window focus so a grant that died while the
  // user was away surfaces here instead of only after the daily refresh.
  useInboxHealthProbeQuery();

  useKeyedPersistentToasts({
    items: () =>
      (linksQuery.isSuccess ? linksQuery.data.links : []).filter(
        (link) => link.needs_reauth
      ),
    key: (link) => link.id,
    toast: (link, dismiss) => ({
      title:
        reconnectScopes(link) === 'gmail_and_calendar'
          ? 'Reconnect email and calendar'
          : 'Reconnect inbox',
      icon:
        reconnectScopes(link) === 'gmail_and_calendar'
          ? CalendarIcon
          : EnvelopeIcon,
      color: 'var(--color-failure)',
      titleColor: 'var(--color-failure)',
      dismissLabel: t('common.maybeLater'),
      content(): string {
        return `Sync stopped for ${link.email_address}. Reconnect to restore ${reconnectScopes(link) === 'gmail_and_calendar' ? 'email and calendar' : 'email'} sync.`;
      },
      actions: [
        {
          label: 'Reconnect',
          icon: ArrowCounterClockwise,
          onClick: () => {
            // Suppress re-prompting until the inbox recovers; on native the page
            // stays mounted while the OAuth flow runs.
            dismiss();
            fireAndForget(
              startAddInbox({
                scopes: reconnectScopes(link),
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
