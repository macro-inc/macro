import { TabsInset } from '@core/component/TabsInset';
import type { ConnectionsProviderSlug } from '@core/constant/settingsConnectionsUrl';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { SettingsPage } from '../primitives';
import { ConnectedView } from './ConnectedView';
import { CursorProvider } from './CursorProvider';
import { DiscoverView } from './DiscoverView';
import { GitHubProvider } from './GitHubProvider';
import { GoogleProvider } from './GoogleProvider';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import { EMPTY_STARTERS, providerIcon } from './provider-meta';
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

const providerTitle = (id: Exclude<ConnectionsProviderSlug, 'other'>): string =>
  EMPTY_STARTERS.find((starter) => starter.id === id)?.name ?? id;

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
      <Show
        when={provider()}
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
        {(activeProvider) => {
          const slug = activeProvider();
          return (
            <Show
              when={slug === 'cursor' || ready()}
              fallback={
                <SettingsPage
                  title={providerTitle(slug)}
                  description={CONNECTIONS_DESCRIPTION}
                  icon={providerIcon(slug)}
                  onBack={closeConnectionsProvider}
                >
                  <p class="text-sm text-ink-muted">Loading…</p>
                </SettingsPage>
              }
            >
              <Switch>
                <Match when={slug === 'github'}>
                  <GitHubProvider model={model()} />
                </Match>
                <Match when={slug === 'google'}>
                  <GoogleProvider model={model()} />
                </Match>
                <Match when={slug === 'linear'}>
                  <PipedreamAiProvider model={model()} provider="linear" />
                </Match>
                <Match when={slug === 'notion'}>
                  <PipedreamAiProvider model={model()} provider="notion" />
                </Match>
                <Match when={slug === 'slack'}>
                  <PipedreamAiProvider model={model()} provider="slack" />
                </Match>
                <Match when={slug === 'cursor'}>
                  <CursorProvider />
                </Match>
              </Switch>
            </Show>
          );
        }}
      </Show>
    </Show>
  );
}
