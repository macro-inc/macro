import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeleteMcpServerMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import {
  type ConnectionsModel,
  type CuratedAiProvider,
  capabilitiesFor,
  curatedNativeUrl,
} from './model';
import { providerIcon } from './provider-meta';
import { connectionState, statusLabel } from './status';
import { showConnectionsOverview } from './view-state';

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
  const updateNative = useUpdateMcpServerMutation();
  const removeNative = useDeleteMcpServerMutation();
  const nativeUrl = () => curatedNativeUrl(props.provider);
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.provider,
      display_name: copy.name,
    }),
    onConnected: () => toast.success(`${copy.name} connected`),
  });

  const connected = () =>
    row()?.status === 'connected' || row()?.status === 'off';

  return (
    <SettingsPage
      title={copy.title}
      description={
        row()?.status === 'connected'
          ? '1 of 1 capability ready'
          : '0 of 1 capabilities ready'
      }
      onBack={showConnectionsOverview}
    >
      <SettingsSection title="Your connections">
        <SettingsCard>
          <SettingsRow
            align="start"
            label={
              <span class="flex items-center gap-2">
                <span class="flex size-9 items-center justify-center [&_svg]:size-5">
                  {providerIcon(props.provider)}
                </span>
                Use {copy.name} with Macro AI
                <Show when={row()}>
                  {(capability) => (
                    <StatusDot
                      state={connectionState(capability().status)}
                      label={statusLabel(capability().status)}
                    />
                  )}
                </Show>
              </span>
            }
            description={`${copy.outcome} Personal · ${
              row() ? statusLabel(row()!.status) : 'Not connected'
            }${
              !row() || row()?.mechanism === 'pipedream'
                ? ' · Powered by Pipedream'
                : ''
            }`}
          >
            <Show
              when={connected()}
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
                        const url = nativeUrl();
                        if (!url) return;
                        updateNative.mutate(
                          { url, enabled: row()?.status === 'off' },
                          {
                            onError: () =>
                              toast.failure('Failed to update connector'),
                          }
                        );
                      }}
                      disabled={updateNative.isPending}
                    />
                    <ConnectAction
                      label="Disconnect from Macro"
                      variant="danger"
                      onClick={() => {
                        const url = nativeUrl();
                        if (!url) return;
                        removeNative.mutate(
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
                      disabled={removeNative.isPending}
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
                          toast.success(`Disconnected ${copy.name} from Macro`),
                        onError: () => toast.failure('Failed to disconnect'),
                      }
                    )
                  }
                  disabled={remove.isPending}
                />
              </Show>
            </Show>
          </SettingsRow>
        </SettingsCard>
        <p class="px-6 text-xs text-ink-extra-muted">{copy.later}</p>
      </SettingsSection>
    </SettingsPage>
  );
}
