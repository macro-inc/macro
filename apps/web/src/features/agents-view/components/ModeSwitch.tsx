import ChatsIcon from '@phosphor/chats.svg';
import CodeIcon from '@phosphor/code.svg';
import { cn, Tabs } from '@ui';
import { type AgentsMode, parseAgentsMode } from '../core/mode';

/**
 * The Chat | Code switch at the top of the sidebar. The two halves share one
 * surface, so this is a segmented control rather than navigation.
 */
export function ModeSwitch(props: {
  mode: AgentsMode;
  onChange: (mode: AgentsMode) => void;
  class?: string;
}) {
  return (
    <Tabs
      aria-label="Agents mode"
      fullWidth
      value={props.mode}
      onChange={(value) => props.onChange(parseAgentsMode(value))}
      list={[
        {
          value: 'chat',
          label: () => (
            <>
              <ChatsIcon aria-hidden="true" class="size-3.5 shrink-0" />
              Chat
            </>
          ),
        },
        {
          value: 'code',
          label: () => (
            <>
              <CodeIcon aria-hidden="true" class="size-3.5 shrink-0" />
              Code
            </>
          ),
        },
      ]}
      class={cn('h-9 rounded-xl bg-ink/4 p-0.5', props.class)}
      itemClass="h-8"
      labelClass="h-8 gap-1.5 text-xs"
    />
  );
}
