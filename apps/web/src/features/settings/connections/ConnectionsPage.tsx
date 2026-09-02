import { TabsInset } from '@core/component/TabsInset';
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
  connectionsMode,
  connectionsProvider,
  showConnectionsDiscover,
  showConnectionsOverview,
} from './view-state';

export function ConnectionsPage() {
  const { model, ready } = useConnectionsModel();
  const provider = connectionsProvider;

  return (
    <Switch
      fallback={
        <SettingsPage
          title="Connections"
          description="What Macro can access, and who it affects."
        >
          <div class="px-6">
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
          </div>
          <Show
            when={ready()}
            fallback={
              <p class="px-6 text-sm text-ink-muted">Loading connections…</p>
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
  );
}
