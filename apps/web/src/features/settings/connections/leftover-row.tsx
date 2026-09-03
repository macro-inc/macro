import { QUICK_CONNECT_ICON_MAP } from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import {
  useDeleteMcpServerMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { ToggleSwitch } from '@ui';
import { createSignal, Show } from 'solid-js';
import { DisconnectAction } from '../integration-ui';
import { IntegrationRow } from '../primitives';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import type { Leftover } from './model';

function leftoverIcon(leftover: Leftover) {
  switch (leftover.kind) {
    case 'pipedream':
      return (
        <PipedreamConnectorIcon appSlug={leftover.appSlug} class="size-8" />
      );
    case 'native-mcp': {
      const Icon = QUICK_CONNECT_ICON_MAP.get(leftover.url) ?? PlugIcon;
      return <Icon class="size-8" />;
    }
    default: {
      const _exhaustive: never = leftover;
      return _exhaustive;
    }
  }
}

function leftoverCanToggle(leftover: Leftover): boolean {
  switch (leftover.kind) {
    case 'pipedream':
      return true;
    case 'native-mcp':
      return leftover.authenticated;
    default: {
      const _exhaustive: never = leftover;
      return _exhaustive;
    }
  }
}

export function LeftoverRow(props: { leftover: Leftover }) {
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const updateNative = useUpdateMcpServerMutation();
  const deleteNative = useDeleteMcpServerMutation();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();

  const busy = () =>
    updateNative.isPending ||
    deleteNative.isPending ||
    updatePipedream.isPending ||
    deletePipedream.isPending;

  const toggle = () => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        updateNative.mutate(
          { url: leftover.url, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update server') }
        );
        return;
      case 'pipedream':
        updatePipedream.mutate(
          { app_slug: leftover.appSlug, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update connector') }
        );
        return;
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  const remove = () => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        deleteNative.mutate(
          { url: leftover.url },
          {
            onSuccess: () => toast.success('Disconnected from Macro'),
            onError: () => toast.failure('Failed to disconnect'),
          }
        );
        return;
      case 'pipedream':
        deletePipedream.mutate(
          { app_slug: leftover.appSlug },
          {
            onSuccess: () => toast.success('Disconnected from Macro'),
            onError: () => toast.failure('Failed to disconnect'),
          }
        );
        return;
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  return (
    <>
      <IntegrationRow
        icon={leftoverIcon(props.leftover)}
        title={props.leftover.title}
        description={props.leftover.subtitle}
      >
        <Show when={leftoverCanToggle(props.leftover)}>
          <ToggleSwitch
            size="md"
            checked={props.leftover.enabled}
            disabled={busy()}
            onChange={toggle}
            label={props.leftover.enabled ? 'Enabled' : 'Disabled'}
            labelClass="inline-block w-14 text-left text-xs text-ink-muted whitespace-nowrap"
          />
        </Show>
        <DisconnectAction
          onClick={() =>
            setDisconnect({
              title: 'Disconnect from Macro',
              body: `Disconnect ${props.leftover.title}?`,
              onConfirm: remove,
            })
          }
          disabled={busy()}
        />
      </IntegrationRow>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </>
  );
}
