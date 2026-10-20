import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import {
  useLinkedAccount,
  useLinkedActions,
  useLinkedConfiguration,
} from '@queries/whatsapp-linked';
import { useSearchParams } from '@solidjs/router';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';
import { SettingsCard, SettingsRow } from '../settings/primitives';
import { PairingFlow } from './views/pairing';

/** Mounted only in the existing Settings account list. */
export function PersonalWhatsAppSettings() {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show when={flag().enabled}>
      <Suspense
        fallback={
          <p class="text-sm text-ink-muted">Loading WhatsApp connection…</p>
        }
      >
        <AccountRow />
      </Suspense>
    </Show>
  );
}
function AccountRow() {
  const userId = useUserId();
  const account = useLinkedAccount(() => userId() ?? '');
  const config = useLinkedConfiguration();
  const actions = useLinkedActions();
  const [params, setParams] = useSearchParams();
  const [flow, setFlow] = createSignal(
    typeof params.whatsappPairing === 'string' ? params.whatsappPairing : ''
  );
  createEffect(() => {
    const id = params.whatsappPairing;
    if (typeof id === 'string' && id) setFlow(id);
  });
  const [error, setError] = createSignal('');
  const [replacing, setReplacing] = createSignal(false);
  const current = () =>
    queryReadyGate(account) ? account.data.account : undefined;
  const connected = () =>
    current()?.state === 'connected' || current()?.state === 'offline';
  async function connect(replace = false) {
    setError('');
    try {
      const result = await actions.connect.mutateAsync(replace);
      setFlow(result.id);
    } catch {
      setError('Could not start connecting. Try again.');
    }
  }
  async function disconnect() {
    setError('');
    try {
      const result = await actions.disconnect.mutateAsync(
        current()!.authorization_generation
      );
      if (!result.remote_unlink_confirmed)
        setError(
          'Disconnected in Macro. Open WhatsApp → Linked devices to remove Macro from your phone.'
        );
    } catch {
      setError('Could not disconnect. Try again.');
    }
  }
  const close = () => {
    setFlow('');
    setParams({ whatsappPairing: undefined }, { replace: true });
  };
  return (
    <>
      <SettingsCard>
        <SettingsRow
          label="WhatsApp"
          description={
            connected()
              ? `+${current()?.identity_jid?.split('@')[0] ?? 'Your personal account'}${current()?.state === 'offline' ? ' · Temporarily offline' : ''}`
              : 'Connect your personal account to existing groups.'
          }
        >
          <Show
            when={connected()}
            fallback={
              <Button
                size="sm"
                disabled={
                  !queryReadyGate(config) ||
                  !config.data.pairing ||
                  actions.connect.isPending
                }
                onClick={() => void connect()}
              >
                {current()?.state === 'reconnect' ? 'Reconnect' : 'Connect'}
              </Button>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={actions.disconnect.isPending}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </Show>
        </SettingsRow>
        <Show when={current() && !flow()}>
          <div class="px-4 pb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplacing(true)}
            >
              Use a different account
            </Button>
          </div>
        </Show>
        <Show when={error()}>
          <p role="alert" class="px-4 pb-3 text-sm text-ink-muted">
            {error()}
          </p>
        </Show>
      </SettingsCard>
      <Show when={replacing()}>
        <Dialog open onOpenChange={setReplacing} class="w-110">
          <Panel depth={2}>
            <Panel.Body>
              <div class="p-6 flex flex-col gap-4">
                <Dialog.Title class="text-lg font-semibold">
                  Replace your WhatsApp account?
                </Dialog.Title>
                <p class="text-sm text-ink-muted">
                  This stops sending and synchronization for your current
                  account. Your Macro history stays available to its authorized
                  audience. Choose groups again after connecting the new
                  account.
                </p>
                <div class="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setReplacing(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={actions.connect.isPending}
                    onClick={() => {
                      setReplacing(false);
                      void connect(true);
                    }}
                  >
                    Replace account
                  </Button>
                </div>
              </div>
            </Panel.Body>
          </Panel>
        </Dialog>
      </Show>
      <Show when={flow()} keyed>
        {(id) => (
          <PairingFlow
            userId={userId() ?? ''}
            pairingId={id}
            onClose={close}
            onConnected={() => {
              close();
              void account.refetch();
            }}
          />
        )}
      </Show>
    </>
  );
}
