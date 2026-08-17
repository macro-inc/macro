import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { useAddInboxFlow } from '@core/email-link';
import {
  useEmailLinksQuery,
  useInboxHealthProbeQuery,
} from '@queries/email/link';

/**
 * Surfaces a per-inbox "Reconnect Gmail" prompt for every linked inbox whose grant
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
      (linksQuery.data?.links ?? []).filter((link) => link.needs_reauth),
    key: (link) => link.id,
    toast: (link, dismiss) => ({
      title: 'Reconnect Gmail',
      content(): string {
        return `Sync stopped for ${link.email_address}. Reconnect to restore email sync.`;
      },
      actions: [
        {
          label: 'Reconnect',
          onClick: () => {
            // Suppress re-prompting until the inbox recovers; on native the page
            // stays mounted while the OAuth flow runs.
            dismiss();
            startAddInbox();
          },
        },
      ],
    }),
  });

  return null;
}
