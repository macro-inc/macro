import { children, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput, useInputCommands } from './context';
import ArrowUpIcon from '@icon/bold/arrow-up-bold.svg';
import SpinnerIcon from '@icon/bold/spinner-gap-bold.svg';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { hasSendableInputContent } from './utils/sendable-content';

export function SendAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);
  const isBlockedByPending = () => !!input().hasPendingAttachments;
  const isBlockedByEmptyInput = () => !hasSendableInputContent(input());

  return (
    <Tooltip tooltip={<LabelAndHotKey label="Send message" />}>
      <button
        aria-label="Send message"
        title="Send message"
        data-input-action="send"
        disabled={isBlockedByPending() || isBlockedByEmptyInput()}
        class={cn('bg-red! group transition ease-in-out', local.class)}
        onPointerDown={(event) => {
          event.preventDefault();
          void commands.send();
        }}
        {...rest}
      >
        <Show
          when={!isBlockedByPending()}
          fallback={<SpinnerIcon class="size-6 animate-spin cursor-disabled" />}
        >
          {resolved() ?? (
            <div class="group-hover:scale-115 group-hover:bg-accent transition ease-in-out size-6 touch:size-8 border border-accent rounded-full flex items-center justify-center">
              <ArrowUpIcon class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
            </div>
          )}
        </Show>
      </button>
    </Tooltip>
  );
}
