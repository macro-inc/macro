import { tryMacroId, useDisplayName } from '@core/user';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type SenderNameProps = {
  class?: string;
  hidden?: boolean;
};

export function SenderName(props: SenderNameProps) {
  const message = useMessage();
  const macroId = () => tryMacroId(message().sender_id);
  const [displayName] = useDisplayName(macroId());
  const isBot = () =>
    message().sender?.type === 'bot' || message().sender_id.startsWith('bot|');
  const botName = () =>
    `Bot ${message().sender?.id ?? message().sender_id.replace(/^bot\|/, '')}`;

  return (
    <Show when={!props.hidden}>
      <span class={cn('text-sm font-medium truncate', props.class)}>
        <Show when={isBot()} fallback={displayName()}>
          {botName()}
          <span class="ml-1 rounded-[3px] bg-ink/10 px-1 py-0.5 text-[9px] font-semibold leading-none text-ink/60">
            APP
          </span>
        </Show>
      </span>
    </Show>
  );
}
