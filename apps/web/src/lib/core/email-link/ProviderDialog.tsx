import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import {
  Button,
  Dialog,
  type ManagedDialogProps,
  openDialog,
  Panel,
} from '@ui';
import { type Owner, Show } from 'solid-js';

export type EmailProvider = 'GMAIL' | 'OUTLOOK';

/** Shared provider choice for onboarding, empty states and additional inboxes. */
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
            Connect Gmail, Outlook.com, or an individual Microsoft 365 account.
          </Dialog.Description>
          <Button
            variant="strong"
            depth={3}
            disabled={props.disabled}
            onClick={() => props.onSelect('GMAIL')}
          >
            Gmail
          </Button>
          <Button
            variant="strong"
            depth={3}
            disabled={props.disabled || !props.outlookAvailable}
            onClick={() => props.onSelect('OUTLOOK')}
          >
            Outlook / Microsoft 365
          </Button>
          <Show when={!props.outlookAvailable}>
            <p class="text-ink-muted text-sm">
              New Outlook connections are temporarily unavailable.
            </p>
          </Show>
          <Button
            variant="ghost"
            depth={3}
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

/** Cancellation and owner disposal resolve without starting an OAuth attempt. */
export async function selectEmailProvider(
  owner: Owner | null
): Promise<EmailProvider | undefined> {
  let outlookAvailable = false;
  try {
    outlookAvailable = (await fetchEmailConnectionProviders()).outlook;
  } catch {
    /* Gmail remains available when the availability read fails. */
  }
  let selected: EmailProvider | undefined;
  const handle = openDialog(
    EmailProviderDialog,
    {
      outlookAvailable,
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
