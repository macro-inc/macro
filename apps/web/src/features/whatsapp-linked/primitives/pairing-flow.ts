import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  PairingCancelReason,
  PasskeyCeremony,
  StartedPairing,
  WhatsAppLinkedCapabilities,
} from '../context/whatsapp-linked-context';
import type { PairingStep } from '../core/pairing';
import { createCountdown } from './countdown';

/**
 * Expired codes replaced without a click before the dialog asks for one.
 * WhatsApp's QR session lasts ~2.7 minutes, so this covers about ten.
 */
export const AUTO_ROLLS = 3;

export type PairingFlow = {
  /** Whether the pairing dialog is open. */
  open: Accessor<boolean>;
  step: Accessor<PairingStep>;
  /** A code expired and its replacement is on its way. */
  refreshing: Accessor<boolean>;
  /** The last start (or the dialog's retry) failed. */
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
  cancel: (reason: PairingCancelReason) => Promise<void>;
};

const visible = () => document.visibilityState === 'visible';

/**
 * One owner-bound pairing at a time: start it, poll its step, and close once
 * WhatsApp reports the device linked. Like WhatsApp Web, an expired code is
 * replaced by a new pairing on its own while someone is watching, up to
 * [`AUTO_ROLLS`] times; after that, or once the tab was hidden, the dialog
 * asks for a click.
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
  const [rolls, setRolls] = createSignal(0);
  const [rolling, setRolling] = createSignal(false);
  const [rollFailed, setRollFailed] = createSignal(false);
  // Whether the tab stayed visible for the whole life of the current code.
  const [watched, setWatched] = createSignal(visible());
  const onVisibility = () => {
    if (!visible()) setWatched(false);
  };
  document.addEventListener('visibilitychange', onVisibility);
  onCleanup(() =>
    document.removeEventListener('visibilitychange', onVisibility)
  );

  const poll = capabilities.pairing(() => current()?.pairingId ?? '');
  const secondsLeft = createCountdown(
    () => current()?.expiresAt ?? poll.data?.expiresAt
  );

  const autoRolls = () => watched() && rolls() < AUTO_ROLLS;
  // A pairing the server can't find (expired long ago, or opened by someone
  // else from a desktop handoff link) has failed; its poll has stopped.
  const polled = (): PairingStep =>
    poll.isError
      ? { kind: 'failed' }
      : (poll.data?.step ?? { kind: 'preparing' });
  /** The server ended the current code: WhatsApp ran out of codes or the deadline passed. */
  const serverExpired = () => polled().kind === 'expired';
  // The deadline is the server's; once it passes, a stale QR is not scannable.
  const codeExpired = () =>
    serverExpired() || (polled().kind === 'scan' && secondsLeft() === 0);
  const step = (): PairingStep => {
    if (rollFailed()) return { kind: 'failed' };
    // About to be replaced: no flash of the expired state in between.
    if (rolling() || (codeExpired() && autoRolls()))
      return { kind: 'preparing' };
    return codeExpired() ? { kind: 'expired' } : polled();
  };

  const begin = (pairing: StartedPairing) => {
    setPasskey({ kind: 'idle' });
    setHandedOff(false);
    setRollFailed(false);
    setWatched(visible());
    setCurrent(pairing);
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
        (step().kind === 'connected' || accountLinked()),
      (connected) => {
        if (connected) fireAndForget(finish(), 'whatsapp-linked.pairing');
      }
    )
  );

  const roll = async (expired: string) => {
    setRolls((count) => count + 1);
    setRolling(true);
    const started = await capabilities.connect();
    setRolling(false);
    const now = current()?.pairingId;
    if (now !== expired) {
      // Closed (or restarted) while the next code was on its way: end it.
      if (started.isOk() && started.value.pairingId !== now)
        await capabilities.cancelPairing(
          started.value.pairingId,
          'expired_roll'
        );
      return;
    }
    if (started.isErr()) {
      setRollFailed(true);
      return;
    }
    begin(started.value);
  };

  // Only the server's word starts a new pairing; a fast local clock must not.
  createEffect(
    on(
      () => (serverExpired() ? current()?.pairingId : undefined),
      (expired) => {
        if (expired && autoRolls() && !rolling())
          fireAndForget(roll(expired), 'whatsapp-linked.pairing');
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
    setRolls(0);
    begin(started.value);
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

  const cancel = async (reason: PairingCancelReason) => {
    setStartFailed(false);
    const pairing = current();
    const finished =
      step().kind === 'connected' || accountLinked() || handedOff();
    setCurrent(undefined);
    if (!pairing || finished) return;
    // The server also expires an abandoned pairing; nothing to recover here.
    await capabilities.cancelPairing(pairing.pairingId, reason);
  };

  return {
    open: () => current() !== undefined,
    step,
    refreshing: () =>
      step().kind === 'preparing' && (rolls() > 0 || codeExpired()),
    startFailed,
    start,
    resume: (pairingId) => {
      setRolls(0);
      begin({ pairingId });
    },
    pairingId: () => current()?.pairingId,
    passkey,
    handOff: () => setHandedOff(true),
    confirmPasskey,
    retry: start,
    cancel,
  };
}
