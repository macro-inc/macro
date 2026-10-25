import DownloadSimple from '@phosphor/download-simple.svg';
import X from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * A calendar attachment opened from an email: the event it describes, with
 * the event's own actions, and the file itself one click away. Opening it
 * saves nothing to the viewer's files.
 */
export function CalendarFilePreview(props: {
  fileName: string;
  open: boolean;
  onClose: () => void;
  /**
   * The attachment chip closing returns focus to; none when a card action
   * leaves the email. The dialog opens without a trigger, so nothing else
   * would.
   */
  returnFocus?: () => HTMLElement | undefined;
  onDownload?: () => void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const chip = props.returnFocus?.();
        if (chip?.isConnected) chip.focus({ preventScroll: true });
      }}
      position="center"
      class="w-140"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="flex items-center gap-2 px-6">
          <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {props.fileName || 'Calendar file'}
          </Dialog.Title>
          <Show when={props.onDownload}>
            <Button
              variant="outline"
              depth={3}
              onClick={() => props.onDownload?.()}
            >
              <DownloadSimple />
              Download .ics
            </Button>
          </Show>
          <Button
            label="Close"
            variant="ghost"
            size="icon-md"
            depth={3}
            class="mobile:hidden"
            onClick={() => props.onClose()}
          >
            <X />
          </Button>
        </Panel.Header>
        <Panel.Body class="max-h-[70vh] overflow-y-auto px-6 pb-3">
          {props.children}
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
