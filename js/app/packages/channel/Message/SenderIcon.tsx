import { UserIcon } from '@core/component/UserIcon';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type SenderIconProps = {
  class?: string;
  hidden?: boolean;
};

export function SenderIcon(props: SenderIconProps) {
  const message = useMessage();
  const isBot = () =>
    message().sender?.type === 'bot' || message().sender_id.startsWith('bot|');
  const botInitial = () => {
    const id =
      message().sender?.id ?? message().sender_id.replace(/^bot\|/, '');
    return id.slice(0, 1).toUpperCase();
  };

  return (
    <div
      class={cn('shrink-0 size-(--user-icon-width)', props.class, {
        invisible: props.hidden,
      })}
      aria-hidden={props.hidden ? 'true' : undefined}
    >
      <Show when={!props.hidden}>
        <Show
          when={isBot()}
          fallback={<UserIcon id={message().sender_id} size="fill" />}
        >
          <div class="relative size-full rounded-md border border-border bg-ink/85 text-white grid place-items-center text-[10px] font-semibold">
            {botInitial()}
            <span class="absolute -bottom-1 -right-1 rounded-[3px] bg-accent px-1 py-0.5 text-[7px] font-semibold leading-none text-white shadow-sm">
              APP
            </span>
          </div>
        </Show>
      </Show>
    </div>
  );
}
