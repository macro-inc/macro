import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import {
  Button,
  Dialog,
  type ManagedDialogProps,
  openDialog,
  Panel,
} from '@ui';
import { type Owner, onCleanup, runWithOwner, Show } from 'solid-js';

export type EmailProvider = 'GMAIL' | 'OUTLOOK';

/**
 * Shared provider choice for onboarding, empty states and additional inboxes.
 * Outlook appears only when the server offers it to this user.
 */
export function EmailProviderDialog(
  props: ManagedDialogProps & {
    onSelect: (provider: EmailProvider) => void;
    disabled?: boolean;
    outlookAvailable: boolean;
  }
) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            Connect email
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight">
            <Show
              when={props.outlookAvailable}
              fallback="Connect a Gmail or Google Workspace account."
            >
              Connect Gmail, Outlook.com, or an individual Microsoft 365
              account.
            </Show>
          </Dialog.Description>
          <p class="text-ink-muted text-sm/tight">
            Macro connects an account's email and calendar together, so keep the
            email permissions checked on the provider's screen.
          </p>
          <Button
            variant="secondary"
            disabled={props.disabled}
            onClick={() => props.onSelect('GMAIL')}
          >
            Gmail
          </Button>
          <Show when={props.outlookAvailable}>
            <Button
              variant="secondary"
              disabled={props.disabled}
              onClick={() => props.onSelect('OUTLOOK')}
            >
              Outlook / Microsoft 365
            </Button>
          </Show>
          <Button
            variant="ghost"
            disabled={props.disabled}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/**
 * Cancellation and owner disposal resolve without starting an OAuth attempt.
 * With Gmail the only provider on offer, there is nothing to choose.
 */
export async function selectEmailProvider(
  owner: Owner | null
): Promise<EmailProvider | undefined> {
  // Registered before the read: a caller gone by the time it answers must not
  // be sent to a consent screen.
  let disposed = false;
  if (owner)
    runWithOwner(owner, () =>
      onCleanup(() => {
        disposed = true;
      })
    );
  let outlookAvailable = false;
  try {
    outlookAvailable = (await fetchEmailConnectionProviders()).outlook;
  } catch {
    /* Gmail remains available when the availability read fails. */
  }
  if (disposed) return undefined;
  if (!outlookAvailable) return 'GMAIL';
  let selected: EmailProvider | undefined;
  const handle = openDialog(
    EmailProviderDialog,
    {
      outlookAvailable: true,
      onSelect: (provider) => {
        selected = provider;
        handle.close();
      },
    },
    { owner }
  );
  await handle.closed;
  return selected;
}
