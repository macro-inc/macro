import { children, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput, useInputCommands } from './context';
import ArrowUpIcon from '@icon/bold/arrow-up-bold.svg';
import SpinnerIcon from '@icon/bold/spinner-gap-bold.svg';
import { renderIcon } from './utils/render-icon';
import { Button } from '@ui/components/Button';
import { LabelAndHotKey } from '@core/component/Tooltip';

export function SendAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);
  const isBlockedByPending = () => !!input().hasPendingAttachments;

  return (
    <Button
      aria-label="Send message"
      title="Send message"
      tooltip={<LabelAndHotKey label="Send message" />}
      data-input-action="send"
      disabled={isBlockedByPending()}
      class={cn(
        'group transition ease-in-out hover:bg-transparent',
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
        fallback={renderIcon(
          SpinnerIcon,
          'size-6 animate-spin cursor-disabled'
        )}
      >
        {resolved() ?? (
          <div class="group-hover:scale-115 group-hover:bg-accent transition ease-in-out size-6 touch:size-8 border border-accent rounded-full flex items-center justify-center">
            {renderIcon(
              ArrowUpIcon,
              'group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out'
            )}
          </div>
        )}
      </Show>
    </Button>
  );
}
