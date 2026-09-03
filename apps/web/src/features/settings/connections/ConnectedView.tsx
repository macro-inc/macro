import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { IntegrationRow, SettingsCard, SettingsSection } from '../primitives';
import type { ConnectionsModel } from './model';
import { isConnectionsEmpty } from './model';
import { EMPTY_STARTERS, providerIcon } from './provider-meta';
import { openConnectionsProvider, showConnectionsDiscover } from './view-state';

export function ConnectedView(props: { model: ConnectionsModel }) {
  return (
    <Show when={!isConnectionsEmpty(props.model)} fallback={<EmptyConnected />}>
      <SettingsSection>
        <SettingsCard>
          <For each={props.model.providers}>
            {(provider) => (
              <button
                type="button"
                class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
                onClick={() => openConnectionsProvider(provider.id)}
              >
                <IntegrationRow
                  icon={providerIcon(provider.id)}
                  title={provider.name}
                  description={provider.summary}
                  facts={provider.accounts}
                >
                  <span class="text-xs text-ink-extra-muted">
                    {provider.ready} of {provider.total}{' '}
                    {provider.total === 1 ? 'capability' : 'capabilities'} ready
                  </span>
                  <CaretRightIcon class="size-4 text-ink-extra-muted" />
                </IntegrationRow>
              </button>
            )}
          </For>
        </SettingsCard>
      </SettingsSection>

      <Button
        type="button"
        variant="outline"
        depth={3}
        class="w-full justify-between"
        onClick={showConnectionsDiscover}
      >
        Add a connection
        <CaretRightIcon class="size-4 text-ink-extra-muted" />
      </Button>

      <Show when={props.model.leftovers.length > 0}>
        <SettingsSection title="Other connections">
          <button
            type="button"
            class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6 rounded-xl"
            onClick={() => openConnectionsProvider('other')}
          >
            <SettingsCard>
              <IntegrationRow
                icon={<span class="text-xs font-medium text-ink-muted">?</span>}
                title={`${props.model.leftovers.length} other connection${
                  props.model.leftovers.length === 1 ? '' : 's'
                }`}
                description="These do not sit under a provider yet."
              >
                <CaretRightIcon class="size-4 text-ink-extra-muted" />
              </IntegrationRow>
            </SettingsCard>
          </button>
        </SettingsSection>
      </Show>
    </Show>
  );
}

function EmptyConnected() {
  return (
    <>
      <SettingsCard>
        <IntegrationRow
          icon={providerIcon('google')}
          title="Start with Google"
          description="Read, organize, and act on your email."
        >
          <Button
            type="button"
            variant="accent"
            size="sm"
            depth={3}
            onClick={() => openConnectionsProvider('google')}
          >
            Connect Google
          </Button>
        </IntegrationRow>
      </SettingsCard>

      <SettingsSection title="Or start with one of these">
        <SettingsCard>
          <For each={EMPTY_STARTERS.filter((item) => item.id !== 'google')}>
            {(item) => (
              <button
                type="button"
                class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
                onClick={() => openConnectionsProvider(item.id)}
              >
                <IntegrationRow
                  icon={providerIcon(item.id)}
                  title={item.name}
                  description={item.note}
                >
                  <CaretRightIcon class="size-4 text-ink-extra-muted" />
                </IntegrationRow>
              </button>
            )}
          </For>
        </SettingsCard>
      </SettingsSection>

      <Button
        type="button"
        variant="outline"
        depth={3}
        class="w-full justify-between"
        onClick={showConnectionsDiscover}
      >
        Browse all connections
        <CaretRightIcon class="size-4 text-ink-extra-muted" />
      </Button>
    </>
  );
}
