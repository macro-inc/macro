import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  useDeleteMcpServerMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { ToggleSwitch } from '@ui';
import { createSignal, Show, type JSX } from 'solid-js';
import { DisconnectAction } from '../integration-ui';
import { IntegrationRow, SettingsRow } from '../primitives';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import type { Leftover } from './model';

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

  const actions = (): JSX.Element => (
    <>
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
      <Show when={leftoverCanToggle(props.leftover)}>
        <ToggleSwitch
          size="md"
          checked={props.leftover.enabled}
          disabled={busy()}
          onChange={toggle}
          label={`Enable ${props.leftover.title}`}
          labelClass="sr-only"
        />
      </Show>
    </>
  );

  const row = (): JSX.Element => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        return (
          <SettingsRow
            label={leftover.title}
            description={leftover.subtitle}
          >
            {actions()}
          </SettingsRow>
        );
      case 'pipedream':
        return (
          <IntegrationRow
            icon={
              <PipedreamConnectorIcon
                appSlug={leftover.appSlug}
                class="size-8"
              />
            }
            title={leftover.title}
            description={leftover.subtitle}
          >
            {actions()}
          </IntegrationRow>
        );
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  return (
    <>
      {row()}
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </>
  );
}
