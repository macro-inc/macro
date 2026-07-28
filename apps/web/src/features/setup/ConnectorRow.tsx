import type { FeaturedMcpServer } from '@core/component/AI/constant/mcpServers';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { cn, Layer } from '@ui';
import { Match, Switch } from 'solid-js';
import { StatusDot } from '../settings/integration-ui';
import { createConnectorConnect } from './useConnectorConnect';

/**
 * One connector in the onboarding flow: brand icon, name, and an explicit
 * trailing status. Clicking an unconnected row starts OAuth in a popup.
 */
export function ConnectorRow(props: {
  server: FeaturedMcpServer;
  connected: boolean;
  authenticated: boolean;
}) {
  const { connect, busy } = createConnectorConnect({
    server: props.server,
    connected: () => props.connected,
    authenticated: () => props.authenticated,
  });

  return (
    <Layer depth={2}>
      <button
        type="button"
        title={
          props.authenticated
            ? `${props.server.server_name} is connected`
            : props.server.tagline
        }
        onClick={() => void connect()}
        class={cn(
          'group flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm',
          'cursor-default outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
          !props.authenticated && 'hover:border-ink/10'
        )}
      >
        <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          <props.server.icon />
        </span>
        <span class="min-w-0 truncate font-medium text-ink">
          {props.server.server_name}
        </span>
        <span class="ml-auto shrink-0">
          <Switch
            fallback={
              <span class="flex items-center gap-1 text-xs font-medium text-ink-muted group-hover:text-ink">
                Connect
                <ArrowUpRightIcon class="size-3 shrink-0" />
              </span>
            }
          >
            <Match when={props.authenticated}>
              <span class="flex items-center gap-1.5 text-xs text-ink-muted">
                <StatusDot state="connected" />
                Connected
              </span>
            </Match>
            <Match when={busy()}>
              <span class="flex items-center gap-1.5 text-xs text-ink-muted">
                <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                Connecting…
              </span>
            </Match>
          </Switch>
        </span>
      </button>
    </Layer>
  );
}
