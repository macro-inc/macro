import { ConfirmDrawer } from '@components/app/mobile/ConfirmDrawer';
import { isMobile } from '@core/mobile/isMobile';
import type { JSX } from 'solid-js';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import {
  type DialogHandle,
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
  };

/** Complete dialog used by `confirmDialog`. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position={props.position}
      class={cn('w-[90%] max-w-120', props.class)}
      visibleScrim
    >
      <Surface depth={2} class="rounded-xl text-ink">
        <div class="flex flex-col gap-1 px-5 py-4">
          <Dialog.Title class="text-base font-semibold">
            {props.title}
          </Dialog.Title>
          <Dialog.Description as="div" class="text-sm leading-5 text-ink-muted">
            {props.body ?? props.children}
          </Dialog.Description>
        </div>
        <div class="flex items-center justify-end gap-2 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            depth={2}
            class="rounded-lg"
            onClick={() => props.onOpenChange(false)}
          >
            {props.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            type="button"
            variant={TONE_VARIANT[props.tone ?? 'default']}
            depth={2}
            class="rounded-lg"
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </Surface>
    </Dialog>
  );
}

function resolveProps<P extends object>(source: PropsSource<P>): P {
  return typeof source === 'function' ? source() : source;
}

/**
 * Opens the shared confirmation UI and resolves with the user's choice —
 * this dialog on desktop, a bottom drawer (`ConfirmDrawer`) on mobile.
 */
export function confirmDialog(
  props: PropsSource<ConfirmDialogDisplayProps>,
  options?: OpenDialogOptions
): Promise<boolean> {
  let confirmed = false;
  let handle!: DialogHandle;

  handle = openDialog(
    isMobile() ? ConfirmDrawer : ConfirmDialog,
    () => ({
      ...resolveProps(props),
      onConfirm: () => {
        confirmed = true;
        handle.close();
      },
    }),
    options
  );

  return handle.closed.then(() => confirmed);
}
