import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
import type { JSX } from 'solid-js';

/** Consistent modal chrome for runtime account and configuration controls. */
export function RuntimeSettingsDialog(props: {
  title: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | undefined;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open
      position="center"
      visibleScrim
      class="w-[min(520px,calc(100vw-24px))]"
      onOpenChange={(open) => !open && !props.busy && props.onClose()}
      onCloseAutoFocus={(event) => {
        const trigger = props.returnFocus?.();
        if (!trigger?.isConnected) return;
        event.preventDefault();
        trigger.focus({ preventScroll: true });
      }}
    >
      <Panel
        depth={2}
        class="relative flex max-h-[88dvh] flex-col overflow-hidden rounded-xl border border-edge text-ink"
      >
        <Panel.Header class="shrink-0 border-b border-edge bg-panel px-6 py-4 pr-14">
          <Dialog.Title class="text-base font-semibold">
            {props.title}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="min-h-0 overflow-y-auto p-6">
          <Dialog.Description class="mb-5 text-sm leading-5 text-ink-muted">
            {props.description}
          </Dialog.Description>
          {props.children}
        </Panel.Body>
        <Panel.Footer class="shrink-0 justify-end border-t border-edge bg-panel px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={props.onClose}
          >
            Done
          </Button>
        </Panel.Footer>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute top-3 right-4"
          aria-label={`Close ${props.title} settings`}
          disabled={props.busy}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </Panel>
    </Dialog>
  );
}
