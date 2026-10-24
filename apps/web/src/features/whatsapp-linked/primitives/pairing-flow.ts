import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type {
  PasskeyCeremony,
  StartedPairing,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import type { PairingStep } from '../core/pairing';
import { createCountdown } from './countdown';

export type PairingFlow = {
  /** Whether the pairing dialog is open. */
  open: Accessor<boolean>;
  step: Accessor<PairingStep>;
  secondsLeft: Accessor<number | undefined>;
  /** Starting a pairing failed before any dialog opened. */
  startFailed: Accessor<boolean>;
  start: () => Promise<void>;
  /** Shows a pairing started elsewhere, e.g. handed off to Macro desktop. */
  resume: (pairingId: string) => void;
  pairingId: Accessor<string | undefined>;
  passkey: Accessor<PasskeyCeremony>;
  /** The pairing continues in Macro desktop; closing here leaves it running. */
  handOff: () => void;
  /** Answers WhatsApp's passkey challenge on this device. */
  confirmPasskey: () => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
};

/**
 * One owner-bound pairing at a time: start it, poll its step, count down its
 * deadline, and close once WhatsApp reports the device linked.
 */
export function createPairingFlow(
  /** The account already reads as linked, e.g. its poll beat the pairing poll. */
  accountLinked: Accessor<boolean>,
  capabilities: Pick<
    WhatsAppLinkedCapabilities,
    'connect' | 'pairing' | 'cancelPairing' | 'pairingFinished' | 'passkey'
  >
): PairingFlow {
  const [current, setCurrent] = createSignal<StartedPairing>();
  const [startFailed, setStartFailed] = createSignal(false);
  const [handedOff, setHandedOff] = createSignal(false);
  const [passkey, setPasskey] = createSignal<PasskeyCeremony>({
    kind: 'idle',
  });
  const poll = capabilities.pairing(() => current()?.pairingId ?? '');
  const secondsLeft = createCountdown(
    () => current()?.expiresAt ?? poll.data?.expiresAt
  );

  const linkedByAccount = accountLinked;
  const step = (): PairingStep => {
    const polled = poll.data?.step ?? { kind: 'preparing' };
    // The deadline is the server's; once it passes, a stale QR is not scannable.
    if (polled.kind === 'scan' && secondsLeft() === 0) {
      return { kind: 'expired' };
    }
    return polled;
  };

  const finish = async () => {
    await capabilities.pairingFinished();
    setCurrent(undefined);
  };

  // The poll is the external system here: react to it reporting success.
  createEffect(
    on(
      () =>
        current() !== undefined &&
        (step().kind === 'connected' || linkedByAccount()),
      (connected) => {
        if (connected) fireAndForget(finish(), 'whatsapp-linked.pairing');
      }
    )
  );

  const start = async () => {
    setStartFailed(false);
    const started = await capabilities.connect();
    if (started.isErr()) {
      setStartFailed(true);
      return;
    }
    setPasskey({ kind: 'idle' });
    setHandedOff(false);
    setCurrent(started.value);
  };

  const confirmPasskey = async () => {
    const pairing = current();
    const polled = step();
    const capability = capabilities.passkey;
    if (
      !pairing ||
      polled.kind !== 'passkey' ||
      !polled.challenge ||
      capability.kind !== 'native' ||
      passkey().kind === 'running'
    )
      return;
    setPasskey({ kind: 'running', event: undefined });
    const result = await capability.authenticate(
      pairing.pairingId,
      polled.challenge,
      (event) => {
        if (passkey().kind === 'running')
          setPasskey({ kind: 'running', event });
      }
    );
    setPasskey(
      result.isErr()
        ? { kind: 'failed', message: result.error.message }
        : { kind: 'idle' }
    );
  };

  const cancel = async () => {
    const pairing = current();
    const finished =
      step().kind === 'connected' || linkedByAccount() || handedOff();
    setCurrent(undefined);
    if (!pairing || finished) return;
    // The server also expires an abandoned pairing; nothing to recover here.
    await capabilities.cancelPairing(pairing.pairingId);
  };

  return {
    open: () => current() !== undefined,
    step,
    secondsLeft,
    startFailed,
    start,
    resume: (pairingId) => {
      setHandedOff(false);
      setPasskey({ kind: 'idle' });
      setCurrent({ pairingId });
    },
    pairingId: () => current()?.pairingId,
    passkey,
    handOff: () => setHandedOff(true),
    confirmPasskey,
    retry: start,
    cancel,
  };
}
