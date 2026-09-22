import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { type JSX, Show } from 'solid-js';

export function ToolTile(props: {
  name: string;
  description?: string;
  icon: JSX.Element;
  connected: boolean;
  busy?: boolean;
  disabled?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <button
      type="button"
      data-tool-tile={props.name}
      style={{
        '--connected-green':
          'color-mix(in oklab, var(--color-success) 72%, var(--color-surface))',
      }}
      aria-label={`${props.busy ? (props.connected ? 'Disconnecting' : 'Connecting to') : props.connected ? 'Disconnect' : 'Connect'} ${props.name}`}
      aria-pressed={props.connected}
      aria-busy={props.busy || undefined}
      title={props.description ?? props.name}
      disabled={props.disabled || props.busy}
      onClick={() =>
        props.connected ? props.onDisconnect() : props.onConnect()
      }
      class="group flex min-w-0 flex-col items-center gap-3 rounded-2xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ink/50 disabled:cursor-default"
    >
      <span
        data-tool-surface
        class="relative flex size-20 items-center justify-center rounded-[22px] bg-[color-mix(in_srgb,var(--color-surface),var(--color-ink)_8%)]"
        classList={{
          glass: !props.connected,
          'border-2 border-[var(--connected-green)]': props.connected,
        }}
      >
        <span class="flex items-center justify-center [&_svg]:size-7 [&_img]:size-7">
          {props.icon}
        </span>
        <span
          class="absolute -right-1.5 -bottom-1.5 z-10 flex size-8 items-center justify-center rounded-full border p-2 shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0"
          classList={{
            'border-[var(--connected-green)] bg-[var(--connected-green)] text-ink ring-2 ring-surface':
              props.connected,
            'border-edge bg-surface text-ink-muted': !props.connected,
          }}
        >
          <Show
            when={!props.busy}
            fallback={<SpinnerIcon class="animate-spin" />}
          >
            <Show when={props.connected} fallback={<PlusIcon />}>
              <CheckIcon />
            </Show>
          </Show>
        </span>
      </span>
      <span class="w-full truncate text-xs font-medium">{props.name}</span>
    </button>
  );
}
