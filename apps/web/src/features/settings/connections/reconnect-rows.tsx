import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import type { PipedreamConnectionResponse } from '@service-cognition/client';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { IntegrationListRow } from './integrations-list';

/** A count of the apps to reconnect, until dismissed for this visit. */
export function ReconnectBanner(props: { count: number }) {
  const [dismissed, setDismissed] = createSignal(false);
  return (
    <Show when={props.count > 0 && !dismissed()}>
      <div
        role="status"
        class="flex items-center justify-between gap-2 rounded-md bg-ink/4 px-3 py-2 text-sm"
      >
        {props.count === 1
          ? '1 app needs reconnecting.'
          : `${props.count} apps need reconnecting.`}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <XIcon class="size-4" />
        </Button>
      </div>
    </Show>
  );
}

export function reconnectDescription(name: string) {
  return `We moved ${name} to our own connection. Reconnect to keep using it.`;
}

/** One click to move a Pipedream connection that Macro Connect now serves. */
export function ReconnectAction(props: {
  connection: PipedreamConnectionResponse;
}) {
  const name = () => props.connection.server_name;
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.connection.app_slug,
      display_name: name(),
    }),
    onConnected: (entry) => toast.success(`${entry.display_name} reconnected`),
  });

  return (
    <ConnectAction
      label="Reconnect"
      ariaLabel={busy() ? `Reconnecting ${name()}` : `Reconnect ${name()}`}
      loading={busy()}
      onClick={() => fireAndForget(connect(), 'connections-settings')}
    />
  );
}

/** The row for a reconnect whose app has no row of its own. */
export function ReconnectRow(props: {
  connection: PipedreamConnectionResponse;
}) {
  return (
    <IntegrationListRow
      icon={
        <PipedreamConnectorIcon
          appSlug={props.connection.app_slug}
          class="size-5"
        />
      }
      name={props.connection.server_name}
      kind="mcp"
      description={reconnectDescription(props.connection.server_name)}
      categories={['Agent tools']}
      status="attention"
      statusLabel="Reconnect required"
    >
      <ReconnectAction connection={props.connection} />
    </IntegrationListRow>
  );
}
