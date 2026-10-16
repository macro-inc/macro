import CheckCircleIcon from '@phosphor/check-circle.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ImportProvider } from '../core/providers';

export type ProviderRowState =
  /** Connections are still loading; no action is offered yet. */
  'unknown' | 'disconnected' | 'connecting' | 'connected';

/** One app in the import dialog: connect it, then import from it. */
export function ProviderRow(props: {
  provider: ImportProvider;
  state: ProviderRowState;
  /** Another action is running; hold this row's buttons. */
  disabled?: boolean;
  onConnect(): void;
  onImport(): void;
}) {
  const native = () => props.provider.native !== undefined;
  return (
    <li class="flex items-center gap-3 py-2.5">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full border border-edge-muted bg-surface">
        <Dynamic
          component={props.provider.icon}
          class="size-5 text-ink"
          aria-hidden="true"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5 text-sm font-medium text-ink">
          {props.provider.name}
          <Show when={props.state === 'connected'}>
            <CheckCircleIcon
              class="size-3.5 text-success"
              aria-label="Connected"
            />
          </Show>
        </span>
        <span class="block truncate text-xs text-ink-muted">
          {props.provider.detail}
          {native() ? '' : ' · with the agent'}
        </span>
      </span>
      <Show
        when={props.state === 'connected'}
        fallback={
          <Button
            variant="outline"
            size="sm"
            disabled={
              props.disabled ||
              props.state === 'unknown' ||
              props.state === 'connecting'
            }
            aria-label={`Connect ${props.provider.name}`}
            onClick={() => props.onConnect()}
          >
            {props.state === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        }
      >
        <Button
          variant="strong"
          size="sm"
          disabled={props.disabled}
          aria-label={`Import from ${props.provider.name}`}
          onClick={() => props.onImport()}
        >
          <Show when={!native()}>
            <SparkleIcon aria-hidden="true" />
          </Show>
          Import
        </Button>
      </Show>
    </li>
  );
}
