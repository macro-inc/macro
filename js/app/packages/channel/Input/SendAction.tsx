import { isMobile } from '@core/mobile/isMobile';
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
  const hasTextInput = () => (input().value?.trim().length ?? 0) > 0;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      tooltip="Send message"
      aria-label="Send message"
      data-input-action="send"
      disabled={isBlockedByPending() || isBlockedByEmptyInput()}
      class={cn(
        'rounded-[11px] size-[30px] bg-edge-muted/60 text-ink-muted [&_svg]:stroke-[2.5] not-disabled:bg-accent not-disabled:text-surface not-disabled:hover:bg-accent/90 data-disabled:opacity-100 data-disabled:bg-edge-muted/60 data-disabled:text-ink-muted',
        isMobile() && !hasTextInput() && 'opacity-0!',
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
