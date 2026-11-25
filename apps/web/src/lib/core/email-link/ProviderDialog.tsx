import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { fetchEmailConnectionProviders } from '@queries/auth/outlook-link';
import type { UserProvider } from '@service-email/generated/schemas/userProvider';
import {
  Button,
  Dialog,
  type DialogHandle,
  type ManagedDialogProps,
  openDialog,
  Panel,
  Spinner,
} from '@ui';
import {
  createEffect,
  createResource,
  type Owner,
  Show,
  untrack,
} from 'solid-js';
import { OutlookBetaBadge } from './OutlookBetaBadge';

/**
 * Shared provider choice for onboarding, empty states and additional inboxes.
 * Outlook appears only when the server offers it to this user.
 */
export function EmailProviderDialog(
  props: ManagedDialogProps & {
    onSelect: (provider: UserProvider) => void;
    disabled?: boolean;
    outlookAvailable: boolean;
    gmailAvailable?: boolean;
    imapAvailable?: boolean;
    loading?: boolean;
    failed?: boolean;
    onRetry?: () => void;
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
            {t('imap.connectEmail')}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight">
            <Show
              when={props.imapAvailable || props.loading || props.failed}
              fallback={
                props.outlookAvailable
                  ? t('imap.googleOrMicrosoftDescription')
                  : t('imap.googleDescription')
              }
            >
              {t('imap.chooseProvider')}
            </Show>
          </Dialog.Description>
          <p class="text-ink-muted text-sm/tight">
            {t('imap.providerPermissions')}
          </p>
          <Show when={props.loading}>
            <div
              role="status"
              class="flex items-center gap-2 text-sm text-ink-muted"
            >
              <Spinner decorative />
              {t('imap.loadingProviders')}
            </div>
          </Show>
          <Show when={props.failed}>
            <div role="alert" class="text-sm text-ink-muted">
              {t('imap.loadProvidersFailed')}
            </div>
            <Button variant="secondary" onClick={props.onRetry}>
              {t('imap.retry')}
            </Button>
          </Show>
          <Show when={!props.loading && !props.failed}>
            <Show when={props.gmailAvailable !== false}>
              <Button
                variant="secondary"
                disabled={props.disabled}
                onClick={() => props.onSelect('GMAIL')}
              >
                {t('imap.gmail')}
              </Button>
            </Show>
            <Show when={props.outlookAvailable}>
              <Button
                variant="secondary"
                disabled={props.disabled}
                onClick={() => props.onSelect('OUTLOOK')}
              >
                {t('imap.outlook')}
                <OutlookBetaBadge />
              </Button>
            </Show>
            <Show when={props.imapAvailable}>
              <Button
                variant="secondary"
                disabled={props.disabled}
                onClick={() => props.onSelect('IMAP')}
              >
                {t('imap.otherProvider')}
              </Button>
            </Show>
          </Show>
          <Button
            variant="ghost"
            disabled={props.disabled}
            onClick={() => props.onOpenChange(false)}
          >
            {t('imap.cancel')}
          </Button>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

/** Shared loading/error handling for settings, onboarding and another account. */
export function EmailProviderSelectionDialog(
  props: ManagedDialogProps & {
    onSelect: (provider: UserProvider) => void;
    mailOnly: boolean;
    disabled?: boolean;
  }
) {
  const [availability, { refetch }] = createResource(
    () => props.open,
    (open) => (open ? fetchEmailConnectionProviders() : undefined)
  );
  let automaticallySelected = false;
  createEffect(() => {
    if (!props.open) {
      automaticallySelected = false;
      return;
    }
    if (
      availability.loading ||
      availability.error ||
      props.disabled ||
      automaticallySelected
    )
      return;
    const offered = availability();
    // A failed or pending read never authorizes a provider. IMAP keeps its
    // explicit chooser and server-confirmation flow even when it is alone.
    if (!offered || (props.mailOnly && offered.imap)) return;
    const choices: UserProvider[] = [];
    if (offered.gmail !== false) choices.push('GMAIL');
    if (offered.outlook) choices.push('OUTLOOK');
    const [single] = choices;
    if (choices.length !== 1 || !single) return;
    automaticallySelected = true;
    fireAndForget(
      untrack(() => props.onSelect(single)),
      'email-provider-selection'
    );
  });
  return (
    <EmailProviderDialog
      {...props}
      loading={availability.loading}
      failed={!!availability.error}
      onRetry={() => fireAndForget(refetch(), 'email-providers')}
      gmailAvailable={!availability.error && availability()?.gmail !== false}
      outlookAvailable={!availability.error && availability()?.outlook === true}
      imapAvailable={
        !availability.error && props.mailOnly && availability()?.imap === true
      }
    />
  );
}

/**
 * Cancellation and owner disposal resolve without starting an OAuth attempt.
 * A selection callback owns closing the chooser after its next dialog is ready.
 */
export async function selectEmailProvider(
  owner: Owner | null,
  mailOnly = true,
  onSelection?: (provider: UserProvider, dialog: DialogHandle) => void
): Promise<UserProvider | undefined> {
  const trace = Telemetry.captureContext();
  let selected: UserProvider | undefined;
  const handle = openDialog(
    EmailProviderSelectionDialog,
    {
      mailOnly,
      onSelect: (provider) => {
        if (selected !== undefined) return;
        selected = provider;
        if (onSelection) onSelection(provider, handle);
        else handle.close();
      },
    },
    { owner }
  );
  const closed = await handle.closed;
  trace.run(() => {
    const span = Telemetry.span('email.providers.close');
    span.setAttr(
      'dialog.close_reason',
      selected !== undefined && closed.reason === 'programmatic'
        ? 'completed'
        : closed.reason
    );
    span.end();
  });
  return selected;
}
