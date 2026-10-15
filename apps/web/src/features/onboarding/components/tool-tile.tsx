import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Show } from 'solid-js';
import type { Tool, ToolConnectionState } from '../context/onboarding-context';

export function ToolTile(props: {
  tool: Tool;
  state: ToolConnectionState;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
}) {
  const connected = () =>
    props.state === 'connected' || props.state === 'account-linked';
  const label = () =>
    props.state === 'account-linked'
      ? 'Account linked'
      : props.state === 'connected'
        ? 'Connected'
        : props.state === 'disabled'
          ? 'Enable'
          : props.state === 'loading'
            ? 'Checking connection…'
            : props.state === 'error'
              ? 'Status unavailable'
              : 'Integration';
  return (
    <button
      type="button"
      aria-label={`${props.state === 'account-linked' ? 'Account linked to' : connected() ? 'Connected to' : props.busy ? 'Connecting' : props.state === 'disabled' ? 'Enable' : 'Connect'} ${props.tool.name}`}
      aria-busy={props.busy}
      disabled={props.disabled || props.busy || connected()}
      onClick={() => props.onConnect()}
      class="group flex min-w-0 flex-col items-center gap-3 rounded-2xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
    >
      <span
        class="onboarding-tool-icon relative flex size-20 items-center justify-center rounded-[22px] bg-ink/5 transition-colors group-hover:bg-ink/10"
        classList={{
          glass: !connected(),
          'border-2 border-success': connected(),
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
              connected(),
            'border-edge bg-surface text-ink-muted': !connected(),
          }}
        >
          <Show
            when={!props.busy}
            fallback={<SpinnerIcon class="size-3.5 animate-spin" />}
          >
            <Show when={connected()} fallback={<PlusIcon class="size-3.5" />}>
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
          {label()}
        </span>
      </span>
    </button>
  );
}
