import { toast } from '@core/component/Toast/Toast';
import { useDeleteMcpServerMutation } from '@queries/mcp-servers';
import { useDeletePipedreamConnectionMutation } from '@queries/pipedream-connectors';
import { createSignal, For } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { IntegrationRow, SettingsCard, SettingsPage } from '../primitives';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import type { Leftover } from './model';
import { closeConnectionsProvider } from './view-state';

export function OtherView(props: { leftovers: Leftover[] }) {
  return (
    <SettingsPage
      title="Other Connections">
      description="These do not sit under a provider yet."
      onBack={closeConnectionsProvider}
    >
      <SettingsCard>
        <For each={props.leftovers}>
          {(item) => <LeftoverRow leftover={item} />}
        </For>
      </SettingsCard>
      <p class="text-xs text-ink-extra-muted">
        If one later maps to a provider, it moves there. Until then it stays
        here.
      </p>
    </SettingsPage>
  );
}

function LeftoverRow(props: { leftover: Leftover }) {
  const [disconnectConfirm, setDisconnectConfirm] =
    createSignal<DisconnectConfirm | null>(null);
  const deleteNative = useDeleteMcpServerMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();

  const disconnect = () => {
    if (props.leftover.mechanism === 'pipedream') {
      const slug = props.leftover.id.replace(/^pipedream:/, '');
      deletePipedream.mutate(
        { app_slug: slug },
        {
          onSuccess: () => toast.success('Disconnected from Macro'),
          onError: () => toast.failure('Failed to disconnect'),
        }
      );
      return;
    }
    const url = props.leftover.id.replace(/^mcp:/, '');
    deleteNative.mutate(
      { url },
      {
        onSuccess: () => toast.success('Disconnected from Macro'),
        onError: () => toast.failure('Failed to disconnect'),
      }
    );
  };

  return (
    <>
      <IntegrationRow
        icon={<span class="text-xs font-medium text-ink-muted">?</span>}
        title={props.leftover.title}
        description={props.leftover.note}
        facts={props.leftover.facts}
      >
        <ConnectAction
          label="Disconnect from Macro"
          variant="danger"
          onClick={() =>
            setDisconnectConfirm({
              title: 'Disconnect from Macro',
              body: `Disconnect ${props.leftover.title}?`,
              onConfirm: disconnect,
            })
          }
          disabled={deleteNative.isPending || deletePipedream.isPending}
        />
      </IntegrationRow>
      <DisconnectConfirmDialog
        request={disconnectConfirm()}
        onClose={() => setDisconnectConfirm(null)}
      />
    </>
  );
}
