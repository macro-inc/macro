import { ActionDialogShell, Button, Dialog } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { PasskeyCeremony } from '../context/whatsapp-linked-context';
import { formatCountdown, type PairingStep } from '../core/pairing';
import { ConnectionCode } from './connection-code';

const STEPS = [
  'Open WhatsApp on your phone',
  'Go to Settings → Linked devices',
  'Tap Link a device',
  'Point your phone at this code',
];

function CodeSlot(props: {
  qr: string | undefined;
  secondsLeft: number | undefined;
}) {
  return (
    <div class="flex flex-col items-center gap-2">
      <Show
        when={props.qr}
        fallback={
          <div
            role="status"
            class="flex size-56 items-center justify-center rounded-xl border border-edge-muted text-sm text-ink-muted"
          >
            Preparing code…
          </div>
        }
      >
        {(qr) => (
          <ConnectionCode
            value={qr()}
            label="Scan this code with WhatsApp on your phone"
          />
        )}
      </Show>
      <p class="h-4 text-xs text-ink-subtle">
        <Show when={props.qr ? props.secondsLeft : undefined}>
          {(seconds) => <>Expires in {formatCountdown(seconds())}</>}
        </Show>
      </p>
    </div>
  );
}

function Steps() {
  return (
    <ol class="flex flex-col gap-2 text-sm text-ink-muted">
      <For each={STEPS}>
        {(step, index) => (
          <li class="flex items-start gap-3">
            <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium text-ink">
              {index() + 1}
            </span>
            <span class="leading-5">{step}</span>
          </li>
        )}
      </For>
    </ol>
  );
}

/** How this device can answer WhatsApp's passkey challenge. */
export type PasskeyMode =
  | { kind: 'native' }
  | { kind: 'handoff'; desktopUrl: string }
  | { kind: 'unsupported' };

function PasskeyStep(props: {
  mode: PasskeyMode;
  challengeReady: boolean;
  ceremony: PasskeyCeremony;
  onConfirm: () => void;
  onHandOff: () => void;
}) {
  const running = () =>
    props.ceremony.kind === 'running' ? props.ceremony : undefined;
  const failure = () =>
    props.ceremony.kind === 'failed' ? props.ceremony.message : undefined;
  const fidoQr = () => {
    const event = running()?.event;
    return event?.type === 'qr' ? event.value : undefined;
  };
  const desktopUrl = () =>
    props.mode.kind === 'handoff' ? props.mode.desktopUrl : undefined;
  return (
    <div class="flex flex-col items-start gap-3" data-linked-passkey>
      <p class="text-sm font-medium text-ink">Confirm on your desktop</p>
      <Switch>
        <Match when={props.mode.kind === 'native'}>
          <p class="text-sm text-ink-muted">
            WhatsApp asks you to confirm this link with your phone's passkey.
            Keep Bluetooth on and your phone nearby.
          </p>
          <Show when={fidoQr()}>
            {(value) => (
              <div class="flex w-full flex-col items-center gap-2">
                <ConnectionCode
                  value={value()}
                  label="Scan this code with your phone's camera to confirm"
                />
                <p class="text-xs text-ink-subtle">
                  Scan with your phone's camera, not WhatsApp.
                </p>
              </div>
            )}
          </Show>
          <Show when={running()?.event?.type === 'touch'}>
            <p role="status" class="text-sm text-ink">
              Confirm on your phone.
            </p>
          </Show>
          <Show when={running()?.event?.type === 'processing'}>
            <p role="status" class="text-sm text-ink-muted">
              Checking with WhatsApp…
            </p>
          </Show>
          <Show when={failure()}>
            {(message) => (
              <p role="alert" class="text-sm text-failure-ink">
                {message()}
              </p>
            )}
          </Show>
          <Button
            type="button"
            variant="strong"
            disabled={!props.challengeReady || !!running()}
            onClick={props.onConfirm}
          >
            {running()
              ? 'Waiting for your phone…'
              : failure()
                ? 'Try again'
                : 'Confirm with passkey'}
          </Button>
        </Match>
        <Match when={desktopUrl()}>
          {(url) => (
            <>
              <p class="text-sm text-ink-muted">
                WhatsApp asks for your phone's passkey, which only the Macro
                desktop app can use. Finish this same request there.
              </p>
              <a
                href={url()}
                onClick={props.onHandOff}
                class="text-sm font-medium text-ink underline underline-offset-2"
              >
                Continue in Macro desktop
              </a>
            </>
          )}
        </Match>
        <Match when={props.mode.kind === 'unsupported'}>
          <p role="alert" class="text-sm text-ink-muted">
            WhatsApp asks for your phone's passkey, which only the Macro desktop
            app can use. Start linking again from Macro on your computer.
          </p>
        </Match>
      </Switch>
    </div>
  );
}

/**
 * Linking WhatsApp as a device. Pairing material stays inside this
 * `ph-no-capture` dialog, out of session replay.
 */
export function PairingDialog(props: {
  open: boolean;
  step: PairingStep;
  secondsLeft: number | undefined;
  passkey: PasskeyMode;
  ceremony: PasskeyCeremony;
  onConfirmPasskey: () => void;
  /** The person continued in Macro desktop; closing must not cancel. */
  onHandOff: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const qr = () => (props.step.kind === 'scan' ? props.step.qr : undefined);
  const code = () => (props.step.kind === 'code' ? props.step.code : undefined);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      position="center"
      class="ph-no-capture w-110"
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>Link WhatsApp</ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {props.step.kind === 'passkey'
                ? 'WhatsApp wants to confirm it’s you before linking.'
                : props.step.kind === 'code'
                  ? 'Enter this code on the phone that has your WhatsApp account.'
                  : 'Scan this code with the phone that has your WhatsApp account.'}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <Switch>
            <Match
              when={
                props.step.kind === 'scan' || props.step.kind === 'preparing'
              }
            >
              <CodeSlot qr={qr()} secondsLeft={props.secondsLeft} />
              <Steps />
            </Match>
            <Match when={code()}>
              {(code) => (
                <div class="flex flex-col items-center gap-4">
                  <p class="text-sm text-ink-muted">
                    In WhatsApp, open Linked devices, tap Link with phone number
                    instead, and enter this code.
                  </p>
                  <strong class="text-2xl tracking-widest text-ink">
                    {code()}
                  </strong>
                </div>
              )}
            </Match>
            <Match when={props.step.kind === 'passkey'}>
              <PasskeyStep
                mode={props.passkey}
                challengeReady={
                  props.step.kind === 'passkey' && !!props.step.challenge
                }
                ceremony={props.ceremony}
                onConfirm={props.onConfirmPasskey}
                onHandOff={props.onHandOff}
              />
            </Match>
            <Match when={props.step.kind === 'connected'}>
              <p role="status" class="text-sm text-ink-muted">
                Linked. Loading your groups…
              </p>
            </Match>
            <Match
              when={
                props.step.kind === 'expired' ||
                props.step.kind === 'failed' ||
                props.step.kind === 'cancelled'
              }
            >
              <div class="flex flex-col items-start gap-3">
                <p role="alert" class="text-sm text-ink-muted">
                  {props.step.kind === 'expired'
                    ? 'This code expired before it was scanned.'
                    : "Linking didn't finish."}
                </p>
                <Button type="button" variant="strong" onClick={props.onRetry}>
                  Show a new code
                </Button>
              </div>
            </Match>
          </Switch>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button
            type="button"
            variant="ghost"
            depth={2}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
