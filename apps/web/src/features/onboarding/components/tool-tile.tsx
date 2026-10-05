import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { Show } from 'solid-js';
import type { Tool } from '../context/onboarding-context';

export function ToolTile(props: {
  tool: Tool;
  connected: boolean;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${props.connected ? 'Connected to' : props.busy ? 'Connecting' : 'Connect'} ${props.tool.name}`}
      aria-busy={props.busy}
      disabled={props.disabled || props.busy || props.connected}
      onClick={() => props.onConnect()}
      class="group flex min-w-0 flex-col items-center gap-3 rounded-2xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
    >
      <span
        class="relative flex size-20 items-center justify-center rounded-[22px] bg-ink/5 transition-colors group-hover:bg-ink/10"
        classList={{
          glass: !props.connected,
          'border-2 border-success': props.connected,
        }}
      >
        <PipedreamConnectorIcon
          appSlug={props.tool.slug}
          iconUrl={props.tool.iconUrl}
          class="size-7"
        />
        <span
          class="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border shadow-sm"
          classList={{
            'border-success bg-success text-ink ring-2 ring-surface':
              props.connected,
            'border-edge bg-surface text-ink-muted': !props.connected,
          }}
        >
          <Show
            when={!props.busy}
            fallback={<SpinnerIcon class="size-3.5 animate-spin" />}
          >
            <Show
              when={props.connected}
              fallback={<PlusIcon class="size-3.5" />}
            >
              <CheckIcon class="size-3.5" />
            </Show>
          </Show>
        </span>
      </span>
      <span class="flex w-full flex-col gap-1">
        <span class="w-full break-words text-xs font-medium">
          {props.tool.name}
        </span>
        <span class="text-[11px] font-normal text-ink-extra-muted">
          {props.connected ? 'Connected' : 'Integration'}
        </span>
      </span>
    </button>
  );
}
