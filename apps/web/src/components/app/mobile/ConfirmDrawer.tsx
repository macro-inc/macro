import SpinnerIcon from '@phosphor/spinner.svg';
import CloseIcon from '@phosphor/x.svg';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { Button } from '@ui/components/Button';
import type { ConfirmDialogProps } from '@ui/components/ConfirmDialog';
import { cn } from '@ui/utils/classname';
import { createUniqueId, Show } from 'solid-js';
import { MobileDrawer } from './MobileDrawer';

/** Controlled confirmation sheet; pending actions remain visible until resolved. */
export function ConfirmDrawer(props: ConfirmDialogProps) {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const close = () => {
    if (!props.pending) props.onOpenChange(false);
  };
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={(open) => !open && close()}
      closeOnOutsidePointer={!props.pending}
      closeOnEscapeKeyDown={!props.pending}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          class="overflow-hidden"
        >
          <MobileDrawer.Handle class="pb-1" />
          <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
            <h2
              id={titleId}
              class="text-[18px] leading-6 font-semibold text-ink"
            >
              {props.title}
            </h2>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Close confirmation"
              class="rounded-full bg-ink/6"
              disabled={props.pending}
              onClick={close}
            >
              <CloseIcon class="size-5" />
            </Button>
          </div>
          <MobileDrawer.ScrollBody>
            <div
              id={descriptionId}
              class="px-6 pb-6 text-sm leading-5 text-ink-muted"
            >
              {props.body ?? props.children}
            </div>
          </MobileDrawer.ScrollBody>
          <ActionDialogShell.Footer class="gap-3">
            <Button
              variant="ghost"
              size="xl"
              class="min-w-0 flex-1 rounded-full bg-ink/6"
              disabled={props.pending}
              onClick={close}
            >
              {props.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant="ghost"
              size="xl"
              class={cn(
                'min-w-0 flex-1 rounded-full',
                props.tone === 'danger'
                  ? 'bg-failure-bg text-failure'
                  : props.tone === 'success'
                    ? 'bg-success-bg text-success'
                    : 'bg-accent-bg text-accent'
              )}
              disabled={props.pending}
              onClick={() => !props.pending && props.onConfirm()}
            >
              <Show when={props.pending}>
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
              {props.confirmLabel ?? 'Confirm'}
            </Button>
          </ActionDialogShell.Footer>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
