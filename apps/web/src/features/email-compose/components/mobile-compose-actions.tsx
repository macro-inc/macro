import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import Paperclip from '@phosphor/paperclip.svg';
import { Button, SendButton } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Shared header actions for new emails, replies, and forwards. */
export function MobileComposeActions(props: {
  attachRef?: (element: HTMLButtonElement) => void;
  editingDisabled: boolean;
  scheduleControl?: JSX.Element;
  sendLabel: string;
  sendTooltip?: string;
  sendDisabled: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  return (
    <HeaderIsland class="h-(--mobile-chrome-button-size) p-[5px]">
      <Show when={props.attachRef}>
        <Button
          ref={props.attachRef}
          label="Attach"
          size="icon-sm"
          disabled={props.editingDisabled}
        >
          <Paperclip />
        </Button>
      </Show>
      {props.scheduleControl}
      <SendButton
        tooltip={props.sendTooltip ?? props.sendLabel}
        aria-label={props.sendLabel}
        disabled={props.sendDisabled}
        pending={props.sending}
        onClick={props.onSend}
      />
    </HeaderIsland>
  );
}
