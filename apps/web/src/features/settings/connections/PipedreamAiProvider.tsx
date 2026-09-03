import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type ConnectionsModel,
  type CuratedAiProvider,
  capabilitiesFor,
} from './model';
import { useNativeMcpActions } from './native-actions';
import { providerIcon } from './provider-meta';
import { closeConnectionsProvider } from './view-state';

const COPY: Record<
  Exclude<CuratedAiProvider, 'github'>,
  { title: string; name: string; outcome: string; later: string }
> = {
  linear: {
    title: 'Linear',
    name: 'Linear',
    outcome: 'Let Macro AI create, read, and update Linear issues.',
    later:
      'Importing selected issues as Macro tasks is a later step. It is not a separate connection.',
  },
  notion: {
    title: 'Notion',
    name: 'Notion',
    outcome: 'Let Macro AI search pages and wikis.',
    later:
      'Importing selected pages as Macro docs is a later step. It is not continuous sync, and it is not a separate connection.',
  },
  slack: {
    title: 'Slack',
    name: 'Slack',
    outcome: 'Let Macro AI search conversations and post updates.',
    later:
      'Creating Macro channels from Slack channels is a later step. It is not a second connection.',
  },
};

export function PipedreamAiProvider(props: {
  model: ConnectionsModel;
  provider: Exclude<CuratedAiProvider, 'github'>;
}) {
  const copy = COPY[props.provider];
  const row = () =>
    capabilitiesFor(props.model, props.provider).find(
      (item) => item.id === `${props.provider}-ai`
    );
  const update = useUpdatePipedreamConnectionMutation();
  const remove = useDeletePipedreamConnectionMutation();
  const native = useNativeMcpActions();
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.provider,
      display_name: copy.name,
    }),
    onConnected: () => toast.success(`${copy.name} connected`),
  });

  const granted = () =>
    row()?.status === 'connected' || row()?.status === 'off';

  return (
    <SettingsPage
      title={copy.title}
      description={
        row()?.status === 'connected'
          ? '1 of 1 capability ready'
          : '0 of 1 capabilities ready'
      }
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your connections">
        <SettingsCard>
          <CapabilityRow
            icon={providerIcon(props.provider)}
            title={`Use ${copy.name} with Macro AI`}
            outcome={copy.outcome}
            facts={
              row()
                ? capabilityFacts(row()!)
                : 'Personal · Powered by Pipedream'
            }
            status={row()?.status}
          >
            <Show
              when={row()?.status === 'action-required'}
              fallback={
                <Show
                  when={granted()}
                  fallback={
                    <ConnectAction
                      label="Connect"
                      onClick={() => void connect()}
                      loading={busy()}
                    />
                  }
                >
                  <Show
                    when={row()?.mechanism === 'pipedream'}
                    fallback={
                      <>
                        <ConnectAction
                          label={row()?.status === 'off' ? 'Turn on' : 'Turn off'}
                          variant="neutral"
                          onClick={() => {
                            const url = row()?.sourceUrl;
                            if (!url) return;
                            native.update.mutate(
                              { url, enabled: row()?.status === 'off' },
                              {
                                onError: () =>
                                  toast.failure('Failed to update connector'),
                              }
                            );
                          }}
                          disabled={native.update.isPending}
                        />
                        <ConnectAction
                          label="Disconnect from Macro"
                          variant="danger"
                          onClick={() => {
                            const url = row()?.sourceUrl;
                            if (!url) return;
                            native.remove.mutate(
                              { url },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    `Disconnected ${copy.name} from Macro`
                                  ),
                                onError: () =>
                                  toast.failure('Failed to disconnect'),
                              }
                            );
                          }}
                          disabled={native.remove.isPending}
                        />
                      </>
                    }
                  >
                    <ConnectAction
                      label={row()?.status === 'off' ? 'Turn on' : 'Turn off'}
                      variant="neutral"
                      onClick={() =>
                        update.mutate(
                          {
                            app_slug: props.provider,
                            enabled: row()?.status === 'off',
                          },
                          {
                            onError: () =>
                              toast.failure('Failed to update connector'),
                          }
                        )
                      }
                      disabled={update.isPending}
                    />
                    <ConnectAction
                      label="Disconnect from Macro"
                      variant="danger"
                      onClick={() =>
                        remove.mutate(
                          { app_slug: props.provider },
                          {
                            onSuccess: () =>
                              toast.success(
                                `Disconnected ${copy.name} from Macro`
                              ),
                            onError: () => toast.failure('Failed to disconnect'),
                          }
                        )
                      }
                      disabled={remove.isPending}
                    />
                  </Show>
                </Show>
              }
            >
              <ConnectAction
                label="Reconnect"
                onClick={() => {
                  const url = row()?.sourceUrl;
                  if (!url) return;
                  native.startAuth(url, row()?.account ?? copy.name);
                }}
                disabled={native.authorize.isPending}
              />
            </Show>
          </CapabilityRow>
        </SettingsCard>
        <p class="px-6 text-xs text-ink-extra-muted">{copy.later}</p>
      </SettingsSection>
    </SettingsPage>
  );
}
