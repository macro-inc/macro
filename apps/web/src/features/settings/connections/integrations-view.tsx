import { toast } from '@core/component/Toast/Toast';
import {
  clearPendingConnectApp,
  pendingConnectApp,
} from '@core/pipedream/pendingConnect';
import { fireAndForget } from '@core/util/fireAndForget';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  on,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { SettingsPage, SettingsSurface } from '../primitives';
import { ConnectedView } from './ConnectedView';
import { DiscoverView } from './DiscoverView';
import { capabilitiesFor, type ProviderId } from './model';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import { SlackChannelImportFlow } from './slack-channel-import/SlackChannelImportFlow';
import { useConnectionsModel } from './use-connections-model';
import {
  ConnectionsViewProvider,
  createConnectionsViewState,
  useConnectionsView,
} from './view-state';

function IntegrationSetupCallouts(props: {
  onOpenMacroMcp: () => void;
  onOpenLocalAgents?: () => void;
}) {
  return (
    <div class="flex flex-col gap-2">
      <SettingsSurface class="flex items-center justify-between gap-4 px-4 py-2">
        <p class="text-base font-medium text-ink">
          Use Macro in your favorite AI harness with the official Macro MCP
        </p>
        <Button
          variant="ghost"
          size="md"
          aria-label="Set up Macro in AI apps"
          onClick={props.onOpenMacroMcp}
        >
          Set up
        </Button>
      </SettingsSurface>
      <Show when={props.onOpenLocalAgents}>
        <SettingsSurface class="flex items-center justify-between gap-4 px-4 py-2">
          <p class="text-base font-medium text-ink">
            Stream sessions from your local AI harness to Macro
          </p>
          <Button
            variant="ghost"
            size="md"
            aria-label="Set up local agents"
            onClick={props.onOpenLocalAgents}
          >
            Set up
          </Button>
        </SettingsSurface>
      </Show>
    </div>
  );
}

type IntegrationsViewProps = ParentProps<{
  onOpenMacroMcp: () => void;
  onOpenLocalAgents?: () => void;
  initialProvider?: ProviderId;
}>;

export function IntegrationsView(props: IntegrationsViewProps) {
  const view = createConnectionsViewState({ provider: props.initialProvider });
  return (
    <ConnectionsViewProvider value={view}>
      <ConnectionsContent {...props} />
    </ConnectionsViewProvider>
  );
}

function ConnectionsContent(props: IntegrationsViewProps) {
  const { model, ready, error, partialError, retry } = useConnectionsModel();
  const view = useConnectionsView();
  const [importSlackChannels, setImportSlackChannels] = createSignal(false);
  // External entry points request a connector or the complete channel import flow.
  createEffect(
    on(pendingConnectApp, (requested) => {
      if (!requested) return;
      clearPendingConnectApp();
      if (requested.intent === 'import-slack-channels') {
        setImportSlackChannels(true);
        return;
      }
      fireAndForget(
        connectRequestedApp(requested.appSlug),
        'connections-settings'
      );
    })
  );
  async function connectRequestedApp(appSlug: string) {
    try {
      const outcome = await connectPipedreamApp({ appSlug });
      if (outcome === 'unsupported')
        toast.failure('Connectors are not available on this deployment');
    } catch {
      toast.failure(`Failed to connect ${appSlug}`);
    }
  }
  const slackConnected = () =>
    capabilitiesFor(model(), 'slack').some(
      (capability) =>
        capability.mechanism === 'pipedream' &&
        capability.status === 'connected'
    );

  return (
    <Show
      when={importSlackChannels()}
      fallback={
        <Show
          when={!error()}
          fallback={
            <SettingsPage
              title="Integrations"
              onBack={view.provider() ? view.closeProvider : undefined}
              backLabel="Integrations"
            >
              <IntegrationSetupCallouts
                onOpenMacroMcp={props.onOpenMacroMcp}
                onOpenLocalAgents={props.onOpenLocalAgents}
              />
              {props.children}
              <div class="flex items-center gap-3 text-sm text-ink-muted">
                Couldn't load Connections.
                <Button variant="outline" size="sm" depth={3} onClick={retry}>
                  Retry
                </Button>
              </div>
            </SettingsPage>
          }
        >
          <Show
            when={ready() && view.provider()}
            keyed
            fallback={
              <SettingsPage title="Integrations" bodyClass="mt-6 gap-6">
                <IntegrationSetupCallouts
                  onOpenMacroMcp={props.onOpenMacroMcp}
                  onOpenLocalAgents={props.onOpenLocalAgents}
                />
                {props.children}
                <Show when={partialError()}>
                  <div
                    role="status"
                    class="flex items-center gap-3 text-sm text-ink-muted"
                  >
                    Some connections couldn't be loaded.
                    <Button
                      variant="outline"
                      size="sm"
                      depth={3}
                      onClick={retry}
                    >
                      Retry
                    </Button>
                  </div>
                </Show>
                <Show
                  when={ready()}
                  fallback={
                    <p class="text-sm text-ink-muted">Loading Connections…</p>
                  }
                >
                  <section
                    aria-label="Agent Integrations"
                    class="flex min-w-0 flex-col gap-4"
                  >
                    <h2 class="text-lg font-medium text-ink">
                      Agent Integrations
                    </h2>
                    <section
                      aria-label="Installed integrations"
                      class="min-w-0 w-full"
                    >
                      <h3 class="mb-2 text-base font-medium text-ink">
                        Installed
                      </h3>
                      <ConnectedView model={model()} />
                    </section>
                    <section
                      aria-label="Available integrations"
                      class="min-w-0 w-full"
                    >
                      <DiscoverView model={model()} />
                    </section>
                  </section>
                </Show>
              </SettingsPage>
            }
          >
            {(provider) => (
              <PipedreamAiProvider model={model()} provider={provider} />
            )}
          </Show>
        </Show>
      }
    >
      <Show
        when={ready()}
        fallback={
          <p class="text-sm text-ink-muted">Loading Slack connection…</p>
        }
      >
        <Suspense>
          <SlackChannelImportFlow
            connected={slackConnected()}
            onBack={() => setImportSlackChannels(false)}
          />
        </Suspense>
      </Show>
    </Show>
  );
}
