import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow } from '@core/email-link';
import {
  useEmailLinksQuery,
  useInboxHealthProbeQuery,
} from '@queries/email/link';
import { createEffect, onCleanup } from 'solid-js';

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

  // One persistent toast per broken inbox, keyed by link id.
  const toastIds = new Map<string, number>();
  // Inboxes the user dismissed this session; not re-prompted until they recover.
  const dismissed = new Set<string>();

  const dismissToast = (linkId: string) => {
    const id = toastIds.get(linkId);
    if (id !== undefined) {
      toast.dismiss(id);
      toastIds.delete(linkId);
    }
  };

  createEffect(() => {
    const links = linksQuery.data?.links ?? [];
    const needingReauth = new Set(
      links.filter((link) => link.needs_reauth).map((link) => link.id)
    );

    // Clear toasts and dismissals for inboxes that recovered or were removed, so a
    // later failure can prompt again.
    for (const linkId of [...toastIds.keys()]) {
      if (!needingReauth.has(linkId)) dismissToast(linkId);
    }
    for (const linkId of [...dismissed]) {
      if (!needingReauth.has(linkId)) dismissed.delete(linkId);
    }

    for (const link of links) {
      if (
        !link.needs_reauth ||
        toastIds.has(link.id) ||
        dismissed.has(link.id)
      ) {
        continue;
      }

      const linkId = link.id;
      const id = toast.custom(
        {
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
                dismissed.add(linkId);
                dismissToast(linkId);
                void startAddInbox();
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
