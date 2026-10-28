import { toast } from '@core/component/Toast/Toast';
import {
  clearPendingConnectApp,
  pendingConnectApp,
} from '@core/pipedream/pendingConnect';
import { fireAndForget } from '@core/util/fireAndForget';
import ClaudeIcon from '@icon/claude-color.svg';
import DesktopIcon from '@icon/system/regular/desktop.svg';
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
import { ConnectAction, IntegrationGroup } from '../integration-ui';
import { IntegrationRow, SettingsPage, SettingsSurface } from '../primitives';
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

function AiAppsGroup(props: {
  onOpenMacroMcp: () => void;
  onOpenLocalAgents?: () => void;
}) {
  return (
    <IntegrationGroup title="AI apps">
      <SettingsSurface>
        <IntegrationRow
          icon={<ClaudeIcon />}
          title="Claude Code, Codex, and ChatGPT"
          description="Use your Macro workspace from Claude Code, Codex, ChatGPT, Claude.ai, and IDEs through the Macro MCP server."
        >
          <ConnectAction
            label="Set up"
            variant="neutral"
            ariaLabel="Set up Macro in AI apps"
            onClick={props.onOpenMacroMcp}
          />
        </IntegrationRow>
      </SettingsSurface>
      <Show when={props.onOpenLocalAgents}>
        {(open) => (
          <SettingsSurface>
            <IntegrationRow
              icon={<DesktopIcon />}
              title="Coding agents on your computer"
              description="Pair your computer so Macro agents run on Claude Code, Codex, OpenCode, OpenClaw, or Hermes there, with each session streamed into Macro."
            >
              <ConnectAction
                label="Set up"
                variant="neutral"
                ariaLabel="Set up local agents"
                onClick={open()}
              />
            </IntegrationRow>
          </SettingsSurface>
        )}
      </Show>
    </IntegrationGroup>
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
              {props.children}
              <AiAppsGroup
                onOpenMacroMcp={props.onOpenMacroMcp}
                onOpenLocalAgents={props.onOpenLocalAgents}
              />
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
              <SettingsPage title="Integrations" bodyClass="mt-6 gap-8">
                {props.children}
                <AiAppsGroup
                  onOpenMacroMcp={props.onOpenMacroMcp}
                  onOpenLocalAgents={props.onOpenLocalAgents}
                />
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
                  <IntegrationGroup
                    title="Agent tools"
                    description="Apps your agents can use when you ask them to. Connecting an app doesn't copy its data into Macro; use Import for that."
                  >
                    <section
                      aria-label="Installed integrations"
                      class="min-w-0 w-full"
                    >
                      <h3 class="mb-2 text-sm font-medium text-ink-muted">
                        Installed
                      </h3>
                      <ConnectedView model={model()} />
                    </section>
                    <section
                      aria-label="Available integrations"
                      class="mt-5 min-w-0 w-full"
                    >
                      <DiscoverView model={model()} />
                    </section>
                  </IntegrationGroup>
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
