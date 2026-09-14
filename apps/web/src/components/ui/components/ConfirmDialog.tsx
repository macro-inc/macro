import { ConfirmDrawer } from '@components/app/mobile/ConfirmDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import {
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  type PropsSource,
} from './ImperativeDialog';
import { Surface } from './Surface';

/** Presentation options for the shared confirmation dialog. */
export type ConfirmDialogDisplayProps = {
  title: JSX.Element;
  /** Dialog copy. `children` is used when `body` is omitted. */
  body?: JSX.Element;
  children?: JSX.Element;
  confirmLabel?: JSX.Element;
  cancelLabel?: JSX.Element;
  tone?: 'default' | 'danger' | 'success';
  /** Dialog presentation only; the mobile drawer ignores it. */
  position?: DialogProps['position'];
  /** Dialog presentation only; the mobile drawer ignores it. */
  class?: string;
};

const TONE_VARIANT = {
  default: 'accent',
  danger: 'danger',
  success: 'success',
} as const;

export type ConfirmDialogProps = ManagedDialogProps &
  ConfirmDialogDisplayProps & {
    onConfirm: () => void;
    pending?: boolean;
  };

/** Controlled confirmation UI: a dialog on desktop, a drawer on mobile. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={(open) => !props.pending && props.onOpenChange(open)}
          position={props.position}
          class={cn('w-[90%] max-w-120', props.class)}
          visibleScrim
        >
          <Surface depth={2} class="rounded-xl text-ink">
            <div class="flex flex-col gap-1 px-5 py-4">
              <Dialog.Title class="text-base font-semibold">
                {props.title}
              </Dialog.Title>
              <Dialog.Description
                as="div"
                class="text-sm leading-5 text-ink-muted"
              >
                {props.body ?? props.children}
              </Dialog.Description>
            </div>
            <div class="flex items-center justify-end gap-2 px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                depth={2}
                class="rounded-lg"
                disabled={props.pending}
                onClick={() => props.onOpenChange(false)}
              >
                {props.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={TONE_VARIANT[props.tone ?? 'default']}
                depth={2}
                class="rounded-lg"
                disabled={props.pending}
                onClick={props.onConfirm}
              >
                {props.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </Surface>
        </Dialog>
      }
    >
      <ConfirmDrawer {...props} />
    </Show>
  );
}

/** Slide-out length; keep ≥ MobileDrawer's `duration-200` transition. */
const CLOSE_MS = 250;

/**
 * Opens the shared confirmation UI and resolves with the user's choice —
 * this dialog on desktop, a bottom drawer (`ConfirmDrawer`) on mobile.
 */
export async function confirmDialog(
  props: PropsSource<ConfirmDialogDisplayProps>,
  options?: OpenDialogOptions
): Promise<boolean> {
  let confirmed = false;

  const handle = openDialog(
    (managedProps: ManagedDialogProps & ConfirmDialogDisplayProps) => {
      const [open, setOpen] = createSignal(true);
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      onCleanup(() => clearTimeout(closeTimer));

      const close = (choice: boolean) => {
        if (!open()) return;
        setOpen(false);
        const finalize = () => {
          confirmed = choice;
          managedProps.onOpenChange(false);
        };

        // The manager disposes immediately. Let the mobile drawer animate
        // closed before handing dismissal to it.
        if (isMobile()) closeTimer = setTimeout(finalize, CLOSE_MS);
        else finalize();
      };

      return (
        <ConfirmDialog
          {...managedProps}
          open={managedProps.open && open()}
          onOpenChange={(open) => !open && close(false)}
          onConfirm={() => close(true)}
        />
      );
    },
    props,
    options
  );

  await handle.closed;
  return confirmed;
}
