import { Button, type ConfirmDialogProps } from '@ui';
import { createSignal, Show } from 'solid-js';
import { MobileDrawer } from './MobileDrawer';

const TONE_VARIANT = {
  default: 'accent',
  danger: 'danger',
  success: 'success',
} as const;

/** Slide-out length; keep ≥ MobileDrawer's `duration-200` transition. */
const CLOSE_MS = 250;

/**
 * The mobile presentation of `confirmDialog`: the same confirmation contract
 * rendered as a bottom sheet. `position` and `class` are dialog-presentation
 * options and are ignored here.
 */
export function ConfirmDrawer(props: ConfirmDialogProps) {
  // A managed dismissal disposes the entry immediately, which would cut the
  // drawer's slide-out. Close internally first so the transition plays, then
  // hand the dismissal to the manager.
  const [internalOpen, setInternalOpen] = createSignal(true);
  const requestClose = () => {
    if (!internalOpen()) return;
    setInternalOpen(false);
    setTimeout(() => props.onOpenChange(false), CLOSE_MS);
  };
  const confirm = () => {
    if (!internalOpen()) return;
    setInternalOpen(false);
    setTimeout(() => props.onConfirm(), CLOSE_MS);
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.open && internalOpen()}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      closeOnOutsidePointerStrategy="pointerdown"
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Confirmation">
          <MobileDrawer.Handle />
          <div class="flex flex-col gap-1 px-4 pb-4 pt-1">
            <div class="text-base font-semibold text-ink">{props.title}</div>
            <Show when={props.body ?? props.children}>
              {(body) => <div class="text-sm text-ink-muted">{body()}</div>}
            </Show>
          </div>
          <div class="flex flex-col gap-2 px-4 pb-4">
            <Button
              type="button"
              variant={TONE_VARIANT[props.tone ?? 'default']}
              size="lg"
              class="w-full rounded-lg"
              onClick={confirm}
            >
              {props.confirmLabel ?? 'Confirm'}
            </Button>
            <MobileDrawer.Close
              as={Button}
              type="button"
              variant="ghost"
              size="lg"
              class="w-full rounded-lg"
            >
              {props.cancelLabel ?? 'Cancel'}
            </MobileDrawer.Close>
          </div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
