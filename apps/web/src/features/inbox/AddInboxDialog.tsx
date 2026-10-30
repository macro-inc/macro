import { useAddInboxFlow } from '@core/email-link';
import { EmailProviderDialog } from '@core/email-link/ProviderDialog';
import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import type { ConsentScopes } from '@service-auth/client';
import { createEffect, createSignal, onCleanup } from 'solid-js';

type AddInboxRequest = {
  /** The permissions to ask consent for; the mailbox alone when omitted. */
  scopes?: ConsentScopes;
};

const [request, setRequest] = createSignal<AddInboxRequest | null>(null);

/**
 * Requests the add-inbox confirmation dialog. Rendered at the app root
 * (Layout), gated on this signal, so it opens immediately and independent of
 * the settings surface.
 *
 * Entitlement is enforced by the backend: `POST /link/gmail` answers 402 when
 * the user isn't allowed another inbox, and `useAddInboxFlow` maps that to the
 * multi-inbox paywall — so callers can invoke the add-inbox flow directly
 * without a client-side gate that would have to mirror the backend's rule.
 */
export const openAddInboxDialog = (options?: AddInboxRequest) =>
  setRequest({ scopes: options?.scopes });

export const isAddInboxDialogOpen = () => request() !== null;

/**
 * Confirmation step before the add-inbox OAuth redirect. Confirming kicks off
 * `useAddInboxFlow`, which navigates the page to the chosen provider's consent screen.
 */
export function AddInboxDialog() {
  const addInbox = useAddInboxFlow();
  const [pending, setPending] = createSignal(false);
  const [outlookAvailable, setOutlookAvailable] = createSignal(false);
  createEffect(() => {
    if (!isAddInboxDialogOpen()) return;
    let current = true;
    setOutlookAvailable(false);
    void fetchEmailConnectionProviders()
      .then((providers) => {
        if (current) setOutlookAvailable(providers.outlook);
      })
      .catch(() => {});
    onCleanup(() => {
      current = false;
    });
  });

  onCleanup(() => setRequest(null));

  const handleConfirm = async (provider: 'GMAIL' | 'OUTLOOK') => {
    if (pending()) return;
    setPending(true);
    // On web this navigates away; on native iOS the OAuth completes in place
    // and resolves, so the dialog dismisses itself.
    try {
      await addInbox({ provider, scopes: request()?.scopes });
    } finally {
      setPending(false);
      setRequest(null);
    }
  };

  return (
    <EmailProviderDialog
      open={isAddInboxDialogOpen()}
      onOpenChange={(open) => {
        if (!open) setRequest(null);
      }}
      onSelect={handleConfirm}
      disabled={pending()}
      outlookAvailable={outlookAvailable()}
    />
  );
}
