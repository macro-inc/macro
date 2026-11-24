import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import type { RosterAgent } from '../../core/roster';
import { AgentAvatar } from '../AgentGlyph';

export function AgentBubble(props: {
  agent?: RosterAgent;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      disabled={props.disabled}
      aria-pressed={props.selected}
      class="flex h-auto w-28 shrink-0 flex-col items-center gap-2 p-0 text-ink-muted"
      onClick={props.onSelect}
    >
      <Show
        when={props.agent}
        fallback={
          <span
            class={cn(
              'grid shrink-0 place-items-center rounded-full border border-edge bg-transparent text-ink-muted',
              'size-22'
            )}
          >
            <PlusIcon class="size-7" />
          </span>
        }
      >
        {(agent) => (
          <AgentAvatar
            agent={agent()}
            coder={false}
            class={cn(
              'size-22',
              props.selected && 'outline-2 outline-offset-2 outline-accent'
            )}
            iconClass="size-9"
          />
        )}
      </Show>
      <span class="w-full truncate px-1 text-xs font-normal">
        {props.agent?.name ?? t('agentWork.newAgent')}
      </span>
    </Button>
  );
}
