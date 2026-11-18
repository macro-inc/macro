import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { RosterAgent } from '../../core/roster';
import { AgentIcon } from '../AgentGlyph';

export function AgentBubble(props: {
  agent?: RosterAgent;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      class="flex h-auto w-28 shrink-0 flex-col items-center gap-2 p-0 text-ink-muted"
      onClick={props.onSelect}
    >
      <span
        class="grid size-22 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2"
        classList={{
          'border-[1.5px] border-dashed border-edge bg-transparent':
            !props.agent,
        }}
      >
        <Show when={props.agent} fallback={<PlusIcon class="size-7" />}>
          {(agent) => (
            <Show
              when={agent().avatarUrl}
              fallback={<AgentIcon agent={agent()} class="size-9" />}
            >
              {(url) => (
                <img src={url()} alt="" class="size-full object-cover" />
              )}
            </Show>
          )}
        </Show>
      </span>
      <span class="w-full truncate px-1 text-xs font-normal">
        {props.agent?.name ?? t('agentWork.newAgent')}
      </span>
    </Button>
  );
}
