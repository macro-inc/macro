import { AgentOfflineBadge } from '@core/component/AgentOfflineBadge';
import { modelLabel } from '@core/component/AI/constant/model-label';
import Check from '@icon/system/regular/check.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import type { RosterAgent } from '../core/roster';
import { AgentIcon } from './AgentGlyph';

/** Consistent identity and availability details in desktop and mobile pickers. */
export function AgentPickerIdentity(props: {
  agent: RosterAgent;
  selected: boolean;
  model?: string;
}) {
  const detail = () => {
    if (props.agent.unavailableReason)
      return props.agent.connectLabel ?? props.agent.unavailableReason;
    const model = props.model ?? props.agent.defaultModel;
    return [
      props.agent.share === 'system' && model
        ? undefined
        : props.agent.runtime.label,
      model && modelLabel(model),
    ]
      .filter(Boolean)
      .join(' · ');
  };
  return (
    <>
      <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink/5">
        <AgentIcon agent={props.agent} class="size-[18px]" />
      </span>
      <span class="min-w-0 flex-1 text-left">
        <span class="flex min-w-0 items-center gap-2">
          <span
            class={cn('block min-w-0 truncate text-sm font-medium leading-5', {
              'text-ink-muted': props.agent.offline || props.agent.poweredOff,
            })}
            title={props.agent.name}
          >
            {props.agent.name}
          </span>
          <Show when={props.agent.offline}>
            <AgentOfflineBadge />
          </Show>
          <Show when={props.agent.poweredOff}>
            <AgentOfflineBadge label="Powered off" />
          </Show>
        </span>
        <span
          class="block truncate text-xs leading-4 text-ink-muted"
          title={`${props.agent.name} · ${detail()}`}
        >
          {detail()}
        </span>
      </span>
      <Show when={props.selected}>
        <Check class="size-4 shrink-0 text-accent" />
      </Show>
    </>
  );
}
