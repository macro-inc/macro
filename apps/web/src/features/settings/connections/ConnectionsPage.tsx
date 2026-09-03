import { TabsInset } from '@core/component/TabsInset';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { SettingsPage } from '../primitives';
import { ConnectedView } from './ConnectedView';
import { CursorProvider } from './CursorProvider';
import { DiscoverView } from './DiscoverView';
import { GitHubProvider } from './GitHubProvider';
import { GoogleProvider } from './GoogleProvider';
import { OtherView } from './OtherView';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import { useConnectionsModel } from './use-connections-model';
import {
  closeConnectionsProvider,
  connectionsMode,
  connectionsProvider,
  showConnectionsDiscover,
  showConnectionsOverview,
} from './view-state';

const CONNECTIONS_DESCRIPTION =
  'Connect your accounts so Macro can work across the tools you already use.';

export function ConnectionsPage() {
  const { model, ready, error, retry } = useConnectionsModel();
  const provider = connectionsProvider;

  return (
    <Show
      when={!error()}
      fallback={
        <SettingsPage
          title="Connections"
          description={CONNECTIONS_DESCRIPTION}
          onBack={provider() ? closeConnectionsProvider : undefined}
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
    <Switch
      fallback={
        <SettingsPage
          title="Connections"
          description={CONNECTIONS_DESCRIPTION}
        >
          <TabsInset
            fullWidth
            list={[
              { value: 'connected', label: 'Connected' },
              { value: 'discover', label: 'Discover' },
            ]}
            value={connectionsMode()}
            onChange={(value) => {
              if (value === 'discover') showConnectionsDiscover();
              else showConnectionsOverview();
            }}
          />
          <Show
            when={ready()}
            fallback={
              <p class="text-sm text-ink-muted">Loading Connections…</p>
            }
          >
            <Show
              when={connectionsMode() === 'discover'}
              fallback={<ConnectedView model={model()} />}
            >
              <DiscoverView model={model()} />
            </Show>
          </Show>
        </SettingsPage>
      }
    >
      <Match when={provider() === 'github'}>
        <GitHubProvider model={model()} />
      </Match>
      <Match when={provider() === 'google'}>
        <GoogleProvider model={model()} />
      </Match>
      <Match when={provider() === 'linear'}>
        <PipedreamAiProvider model={model()} provider="linear" />
      </Match>
      <Match when={provider() === 'notion'}>
        <PipedreamAiProvider model={model()} provider="notion" />
      </Match>
      <Match when={provider() === 'slack'}>
        <PipedreamAiProvider model={model()} provider="slack" />
      </Match>
      <Match when={provider() === 'cursor'}>
        <CursorProvider />
      </Match>
      <Match when={provider() === 'other'}>
        <OtherView leftovers={model().leftovers} />
      </Match>
    </Switch>
    </Show>
  );
}
