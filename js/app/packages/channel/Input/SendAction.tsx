import ArrowUp from '@phosphor/arrow-up.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { Button, cn } from '@ui';
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
      class={cn(
        'rounded-xl size-8 bg-edge-muted/60 text-ink-muted not-disabled:bg-[#c86543] not-disabled:text-surface not-disabled:hover:bg-[#b85c3d] data-disabled:opacity-100 data-disabled:bg-edge-muted/60 data-disabled:text-ink-muted',
        local.class
      )}
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
        {resolved() ?? <ArrowUp />}
      </Show>
    </Button>
  );
}
