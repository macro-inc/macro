import SpinnerIcon from '@icon/spinner-gap.svg';
import PaperPlaneRight from '@phosphor-icons/core/regular/paper-plane-right.svg?component-solid';
import { Button } from '@ui';
import { children, type JSX, Show, splitProps } from 'solid-js';
import { useInput, useInputCommands } from './context';
import { hasSendableInputContent } from './utils/sendable-content';

export function SendAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);
  const isBlockedByPending = () => !!input().hasPendingAttachments;
  const isBlockedByEmptyInput = () => !hasSendableInputContent(input());

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      tooltip="Send message"
      aria-label="Send message"
      data-input-action="send"
      disabled={isBlockedByPending() || isBlockedByEmptyInput()}
      class={local.class}
      onPointerDown={(event) => {
        event.preventDefault();
        void commands.send();
      }}
      {...rest}
    >
      <Show
        when={!isBlockedByPending()}
        fallback={<SpinnerIcon class="animate-spin" />}
      >
        {resolved() ?? <PaperPlaneRight />}
      </Show>
    </Button>
  );
}
