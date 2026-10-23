import { ConfirmDialog } from '@ui/components/ConfirmDialog';
import { createSignal, onCleanup } from 'solid-js';

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Asks a user who is alone in a call whether to keep it going before the
 * server ends it at `endsAt`. Dismissing leaves the deadline in place.
 */
export function CallAlonePrompt(props: {
  /** Epoch ms when the server ends the call. */
  endsAt: number;
  pending: boolean;
  onStay: () => void;
  onDismiss: () => void;
}) {
  const [nowMs, setNowMs] = createSignal(Date.now());
  const countdownTimer = globalThis.setInterval(
    () => setNowMs(Date.now()),
    1000
  );
  onCleanup(() => globalThis.clearInterval(countdownTimer));

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onDismiss();
      }}
      title="You're the only one here"
      body={`No one else is in this call. It will end in ${formatRemaining(
        props.endsAt - nowMs()
      )} unless you stay.`}
      confirmLabel="Stay in call"
      cancelLabel="Dismiss"
      pending={props.pending}
      onConfirm={props.onStay}
    />
  );
}
