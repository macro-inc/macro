import { useAddInboxFlow } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ConsentScopes } from '@service-auth/client';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

type AddInboxRequest = {
  /** The permissions to ask consent for; the mailbox alone when omitted. */
  scopes?: ConsentScopes;
};

const [request, setRequest] = createSignal<AddInboxRequest | null>(null);

/** Request the app-owned connection flow; the backend enforces entitlement. */
export const openAddInboxDialog = (options?: AddInboxRequest) => {
  if (request()) return;
  setRequest({ scopes: options?.scopes });
};

export const isAddInboxDialogOpen = () => request() !== null;

/** Keep the chooser and IMAP handoff under the stable app owner. */
export function AddInboxDialog() {
  const addInbox = useAddInboxFlow();
  async function connect(options: AddInboxRequest) {
    try {
      await addInbox({ scopes: options.scopes });
    } finally {
      if (request() === options) setRequest(null);
    }
  }

  onCleanup(() => setRequest(null));
  createEffect(
    on(request, (options) => {
      if (!options) return;
      fireAndForget(connect(options), 'add-inbox');
    })
  );
  return null;
}
