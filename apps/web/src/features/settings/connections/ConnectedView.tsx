import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, buttonClasses } from '@ui';
import { For, Show } from 'solid-js';
import { IntegrationRow, SettingsCard, SettingsSection } from '../primitives';
import { LeftoverRow } from './leftover-row';
import type { ConnectionsModel } from './model';
import { isConnectionsEmpty } from './model';
import { EMPTY_STARTERS, providerIcon } from './provider-meta';
import { openConnectionsProvider, showConnectionsDiscover } from './view-state';

export function ConnectedView(props: { model: ConnectionsModel }) {
  const forceEmpty = useDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES);
  const pipedreamLeftovers = () =>
    props.model.leftovers.filter((row) => row.kind === 'pipedream');
  const customMcps = () =>
    props.model.leftovers.filter((row) => row.kind === 'native-mcp');
  const showConnectors = () =>
    props.model.providers.length > 0 || pipedreamLeftovers().length > 0;
  return (
    <Show
      when={!forceEmpty() && !isConnectionsEmpty(props.model)}
      fallback={<EmptyConnected />}
    >
      <Show when={showConnectors()}>
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
                    description={
                      <span class="ph-no-capture">{provider.summary}</span>
                    }
                    facts={provider.accounts}
                  >
                    <CaretRightIcon class="size-4 text-ink-extra-muted" />
                  </IntegrationRow>
                </button>
              )}
            </For>
            <For each={pipedreamLeftovers()}>
              {(leftover) => <LeftoverRow leftover={leftover} />}
            </For>
          </SettingsCard>
        </SettingsSection>
      </Show>

      <Show when={customMcps().length > 0}>
        <SettingsSection
          title="Custom MCP"
          description="Servers you added by URL."
        >
          <SettingsCard>
            <For each={customMcps()}>
              {(leftover) => <LeftoverRow leftover={leftover} />}
            </For>
          </SettingsCard>
        </SettingsSection>
      </Show>

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
    </Show>
  );
}

function EmptyConnected() {
  const google = EMPTY_STARTERS.find((item) => item.id === 'google');
  return (
    <>
      <SettingsCard>
        <button
          type="button"
          class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
          onClick={() => openConnectionsProvider('google')}
        >
          <IntegrationRow
            icon={providerIcon('google')}
            title="Start with Google"
            description={google?.note}
          >
            <span class={buttonClasses({ variant: 'accent', size: 'sm' })}>
              Connect Google
            </span>
          </IntegrationRow>
        </button>
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
        Browse all Connections
        <CaretRightIcon class="size-4 text-ink-extra-muted" />
      </Button>
    </>
  );
}
