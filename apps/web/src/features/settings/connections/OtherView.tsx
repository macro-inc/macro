import { toast } from '@core/component/Toast/Toast';
import { useDeleteMcpServerMutation } from '@queries/mcp-servers';
import { useDeletePipedreamConnectionMutation } from '@queries/pipedream-connectors';
import { For } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { IntegrationRow, SettingsCard, SettingsPage } from '../primitives';
import type { Leftover } from './model';
import { closeConnectionsProvider } from './view-state';

export function OtherView(props: { leftovers: Leftover[] }) {
  return (
    <SettingsPage
      title="Other connections"
      description="Records Macro cannot place under a provider yet. Shown with the facts Macro can prove. Nothing is hidden or guessed."
      onBack={closeConnectionsProvider}
    >
      <SettingsCard>
        <For each={props.leftovers}>
          {(item) => <LeftoverRow leftover={item} />}
        </For>
      </SettingsCard>
      <p class="px-6 text-xs text-ink-extra-muted">
        If a leftover later maps to a provider, it moves there. Until then it
        stays here.
      </p>
    </SettingsPage>
  );
}

function LeftoverRow(props: { leftover: Leftover }) {
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
    <IntegrationRow
      icon={<span class="text-xs font-medium text-ink-muted">?</span>}
      title={props.leftover.title}
      description={props.leftover.note}
      facts={props.leftover.facts}
    >
      <ConnectAction
        label="Disconnect from Macro"
        variant="danger"
        onClick={disconnect}
        disabled={deleteNative.isPending || deletePipedream.isPending}
      />
    </IntegrationRow>
  );
}
