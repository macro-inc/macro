import { isPlatform } from '@core/util/platform';
import { queryReadyGate } from '@queries/gate';
import { useLinkedActions, useLinkedPairing } from '@queries/whatsapp-linked';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { ConnectionCode } from '../components/connection-code';
import { authenticateWhatsApp } from '../queries/authenticator';

export function PairingFlow(props: {
  userId: string;
  pairingId: string;
  onConnected: () => void;
  onClose: () => void;
}) {
  const pairing = useLinkedPairing(
    () => props.userId,
    () => props.pairingId
  );
  const actions = useLinkedActions();
  const [authenticationCode, setAuthenticationCode] = createSignal('');
  const [authenticating, setAuthenticating] = createSignal(false);
  const [error, setError] = createSignal('');
  let active = true;
  onCleanup(() => {
    active = false;
    setAuthenticationCode('');
  });
  const state = () => (queryReadyGate(pairing) ? pairing.data : undefined);
  createEffect(() => {
    if (state()?.state === 'connected') props.onConnected();
  });
  const close = async () => {
    try {
      await actions.cancel.mutateAsync(props.pairingId);
    } finally {
      props.onClose();
    }
  };
  async function authenticate() {
    const challenge = state()?.challenge;
    if (!challenge || authenticating()) return;
    setAuthenticating(true);
    setError('');
    try {
      const response = await authenticateWhatsApp(challenge, (event) => {
        if (active)
          setAuthenticationCode(event.type === 'qr' ? event.value : '');
      });
      if (!active) return;
      await actions.passkey.mutateAsync({ id: props.pairingId, response });
      await pairing.refetch();
    } catch {
      if (active)
        setError(
          'Authentication could not finish. Check Bluetooth, keep your phone nearby, and try again.'
        );
    } finally {
      if (active) {
        setAuthenticating(false);
        setAuthenticationCode('');
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
      class="w-110 ph-no-capture"
    >
      <Panel depth={2}>
        <Panel.Body>
          <div class="flex flex-col gap-4 p-6">
            <Dialog.Title class="text-lg font-semibold">
              Connect your WhatsApp account
            </Dialog.Title>
            <p class="text-sm text-ink-muted">
              Macro receives account activity as a linked device. Only groups
              you choose are saved and shared in Macro. Your other chats stay
              private to your account.
            </p>
            <Show when={state()?.qr}>
              {(qr) => (
                <>
                  <ConnectionCode value={qr()} />
                  <p class="text-sm">
                    In WhatsApp, open Linked devices and scan this code.
                  </p>
                </>
              )}
            </Show>
            <Show when={state()?.state === 'passkey'}>
              <Show
                when={isPlatform('desktop')}
                fallback={
                  <a
                    class="underline text-sm"
                    href={`macro://app?whatsappPairing=${encodeURIComponent(props.pairingId)}`}
                  >
                    Finish connecting in Macro desktop
                  </a>
                }
              >
                <p class="text-sm">
                  Confirm this connection with your phone’s passkey.
                </p>
                <Show when={authenticationCode()}>
                  {(value) => <ConnectionCode value={value()} />}
                </Show>
                <Button
                  disabled={authenticating()}
                  onClick={() => void authenticate()}
                >
                  {authenticating()
                    ? 'Waiting for your phone…'
                    : 'Authenticate with your phone'}
                </Button>
              </Show>
            </Show>
            <Show when={state()?.state === 'confirmation'}>
              <p class="text-sm">
                Check that this code matches the code on your phone:
              </p>
              <strong class="text-center text-xl tracking-widest">
                {state()?.code}
              </strong>
              <Button
                disabled={actions.confirm.isPending}
                onClick={() =>
                  void actions.confirm.mutateAsync(props.pairingId)
                }
              >
                The codes match
              </Button>
            </Show>
            <Show
              when={state()?.state === 'expired' || state()?.state === 'error'}
            >
              <p role="alert" class="text-sm text-ink-muted">
                This connection could not finish. Close this window and start
                connecting again.
              </p>
            </Show>
            <Show when={pairing.isError}>
              <p role="status" class="text-sm text-ink-muted">
                Connection status is temporarily unavailable. Your connection is
                still in progress; trying again automatically.
              </p>
            </Show>
            <Show when={!state() && !pairing.isError}>
              <p role="status" class="text-sm">
                Preparing your connection…
              </p>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-ink-muted">
                {error()}
              </p>
            </Show>
            <Button variant="ghost" onClick={() => void close()}>
              Cancel
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
