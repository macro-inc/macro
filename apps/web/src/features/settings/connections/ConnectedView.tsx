import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { For, Show } from 'solid-js';
import { IntegrationRow, SettingsSurface } from '../primitives';
import { LeftoverRow } from './leftover-row';
import type { ConnectionsModel } from './model';
import { isConnectionsEmpty } from './model';
import { providerIcon } from './provider-meta';
import { useConnectionsView } from './view-state';

export function ConnectedView(props: { model: ConnectionsModel }) {
  const view = useConnectionsView();
  const forceEmpty = useDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES);
  const pipedreamLeftovers = () =>
    props.model.leftovers.filter((row) => row.kind === 'pipedream');
  const customMcps = () =>
    props.model.leftovers.filter((row) => row.kind === 'native-mcp');
  return (
    <Show
      when={!forceEmpty() && !isConnectionsEmpty(props.model)}
      fallback={
        <SettingsSurface class="px-4 py-5 text-sm text-ink-muted">
          No tools connected yet. Choose one of the available apps to get
          started.
        </SettingsSurface>
      }
    >
      <div class="grid grid-cols-1 gap-3 @[440px]/settings-page:grid-cols-2">
        <For each={props.model.providers}>
          {(provider) => (
            <SettingsSurface class="overflow-hidden">
              <button
                type="button"
                class="h-full w-full text-left outline-none not-touch:hover:overlay-hover focus-visible:overlay-hover"
                onClick={() => view.openProvider(provider.id)}
              >
                <IntegrationRow
                  icon={providerIcon(provider.id)}
                  title={provider.name}
                  class="gap-3 px-4 py-3"
                  description={
                    <span class="text-sm">
                      {provider.ready} of {provider.total} active
                    </span>
                  }
                  facts={provider.accounts || undefined}
                >
                  <span class="flex size-8 shrink-0 items-center justify-center">
                    <CaretRightIcon class="size-4 text-ink-extra-muted" />
                  </span>
                </IntegrationRow>
              </button>
            </SettingsSurface>
          )}
        </For>
        <For each={[...pipedreamLeftovers(), ...customMcps()]}>
          {(leftover) => (
            <SettingsSurface class="overflow-hidden">
              <LeftoverRow leftover={leftover} />
            </SettingsSurface>
          )}
        </For>
      </div>
    </Show>
  );
}
