import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import {
  clearPendingConnectApp,
  pendingConnectApp,
} from '@core/pipedream/pendingConnect';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import { Button } from '@ui';
import { createEffect, on, Show } from 'solid-js';
import { ConnectedView } from './ConnectedView';
import { DiscoverView } from './DiscoverView';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import { SettingsPage } from './primitives';
import { useConnectionsModel } from './use-connections-model';
import { ConnectionsViewProvider, useConnectionsView } from './view-state';

function MacroMcpSignpost(props: { onOpen: () => void }) {
  return (
    <p class="text-xs text-ink-muted text-balance">
      Looking to use Macro in another app?{' '}
      <button
        type="button"
        class="text-link outline-none hover:text-link-hover hover:underline focus-visible:underline"
        onClick={props.onOpen}
      >
        Macro MCP
      </button>
    </p>
  );
}

export function ConnectionsPage(props: { onOpenMacroMcp: () => void }) {
  return (
    <ConnectionsViewProvider>
      <ConnectionsContent onOpenMacroMcp={props.onOpenMacroMcp} />
    </ConnectionsViewProvider>
  );
}

function ConnectionsContent(props: { onOpenMacroMcp: () => void }) {
  const { model, ready, error, partialError, retry } = useConnectionsModel();
  const view = useConnectionsView();
  // Agent replies can request a connection while this page is already mounted.
  createEffect(
    on(pendingConnectApp, (requested) => {
      if (!requested) return;
      clearPendingConnectApp();
      void connectPipedreamApp({ appSlug: requested })
        .then((outcome) => {
          if (outcome === 'unsupported')
            toast.failure('Connectors are not available on this deployment');
        })
        .catch(() => toast.failure(`Failed to connect ${requested}`));
    })
  );
  const description =
    "Connect the tools your team already uses so Macro's agent can work in them.";

  return (
    <Show
      when={!error()}
      fallback={
        <SettingsPage
          title="Connections"
          description={description}
          onBack={view.provider() ? view.closeProvider : undefined}
        >
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
          <SettingsPage
            title="Connections"
            description={description}
            signpost={<MacroMcpSignpost onOpen={props.onOpenMacroMcp} />}
          >
            <TabsInset
              fullWidth
              list={[
                { value: 'connected', label: 'Connected' },
                { value: 'discover', label: 'Discover' },
              ]}
              value={view.mode()}
              onChange={(value) =>
                value === 'discover' ? view.showDiscover() : view.showOverview()
              }
            />
            <Show when={partialError()}>
              <div
                role="status"
                class="flex items-center gap-3 text-sm text-ink-muted"
              >
                Some connections couldn't be loaded.
                <Button variant="outline" size="sm" depth={3} onClick={retry}>
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
              <Show
                when={view.mode() === 'discover'}
                fallback={<ConnectedView model={model()} />}
              >
                <DiscoverView model={model()} />
              </Show>
            </Show>
          </SettingsPage>
        }
      >
        {(provider) => (
          <PipedreamAiProvider model={model()} provider={provider} />
        )}
      </Show>
    </Show>
  );
}
