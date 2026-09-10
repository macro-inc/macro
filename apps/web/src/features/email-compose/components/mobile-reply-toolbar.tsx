import ArrowUp from '@phosphor/arrow-up.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Spinner from '@phosphor/spinner-gap.svg';
import Trash from '@phosphor/trash.svg';
import { Button, type ButtonProps } from '@ui';
import { Show } from 'solid-js';

function ToolbarButton(props: ButtonProps) {
  return (
    <Button
      {...props}
      depth={3}
      variant="ghost"
      size="icon-md"
      noTouchResize
      class="island size-(--mobile-chrome-button-size) rounded-full border-0 bg-chrome p-0 text-ink"
    />
  );
}

/** Reply and forward share the same circular glass controls as the mobile dock. */
export function MobileReplyToolbar(props: {
  discardLabel: string;
  onDiscard: () => void;
  attachRef: (element: HTMLButtonElement) => void;
  onSend: () => void;
  sendDisabled: boolean;
  sending: boolean;
}) {
  return (
    <div
      data-corvu-no-drag=""
      class="sticky top-0 inset-x-0 z-10 flex shrink-0 items-center justify-between bg-surface p-3 pt-0"
    >
      <ToolbarButton label={props.discardLabel} onClick={props.onDiscard}>
        <Trash class="size-(--mobile-chrome-icon-size)" />
      </ToolbarButton>
      <div class="ml-auto flex items-center gap-2">
        <ToolbarButton label="Attach" ref={props.attachRef}>
          <Paperclip class="size-(--mobile-chrome-icon-size)" />
        </ToolbarButton>
        <ToolbarButton
          label="Send email"
          disabled={props.sendDisabled}
          onClick={props.onSend}
        >
          <Show
            when={!props.sending}
            fallback={
              <Spinner class="size-(--mobile-chrome-icon-size) animate-spin" />
            }
          >
            <ArrowUp class="size-(--mobile-chrome-icon-size)" />
          </Show>
        </ToolbarButton>
      </div>
    </div>
  );
}
