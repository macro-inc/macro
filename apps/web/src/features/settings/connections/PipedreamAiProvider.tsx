import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createSignal, Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { CapabilityRow, capabilityFacts } from './capability-row';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import {
  CURATED_AI,
  type ConnectionsModel,
  type CuratedAiProvider,
  capabilitiesFor,
} from './model';
import { useNativeMcpActions } from './native-actions';
import { providerIcon } from './provider-meta';
import { closeConnectionsProvider } from './view-state';

const COPY: Record<
  Exclude<CuratedAiProvider, 'github'>,
  { title: string; name: string; page: string; outcome: string; later: string }
> = {
  linear: {
    title: 'Linear',
    name: 'Linear',
    page: 'Bring your issues into your unified workspace.',
    outcome: CURATED_AI.linear.outcome,
    later:
      'Macro can also import recent issues as tasks later. That is not a separate connection.',
  },
  notion: {
    title: 'Notion',
    name: 'Notion',
    page: 'Bring your docs and wikis into your unified workspace.',
    outcome: CURATED_AI.notion.outcome,
    later:
      'Macro can also import pages as docs later. That is not continuous sync, and it is not a separate connection.',
  },
  slack: {
    title: 'Slack',
    name: 'Slack',
    page: 'Bring your conversations into your unified workspace.',
    outcome: CURATED_AI.slack.outcome,
    later:
      'Macro can also create channels from Slack later. That is not a second connection.',
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

  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const granted = () =>
    row()?.status === 'connected' || row()?.status === 'off';

  return (
    <SettingsPage
      title={copy.title}
      description={copy.page}
      onBack={closeConnectionsProvider}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <CapabilityRow
            icon={providerIcon(props.provider)}
            title={copy.title}
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
                            setDisconnect({
                              title: 'Disconnect from Macro',
                              body: `Disconnect ${copy.name}?`,
                              onConfirm: () =>
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
                                ),
                            });
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
                        setDisconnect({
                          title: 'Disconnect from Macro',
                          body: `Disconnect ${copy.name}?`,
                          onConfirm: () =>
                            remove.mutate(
                              { app_slug: props.provider },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    `Disconnected ${copy.name} from Macro`
                                  ),
                                onError: () =>
                                  toast.failure('Failed to disconnect'),
                              }
                            ),
                        })
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
        <p class="text-xs text-ink-extra-muted">{copy.later}</p>
      </SettingsSection>
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
    </SettingsPage>
  );
}
