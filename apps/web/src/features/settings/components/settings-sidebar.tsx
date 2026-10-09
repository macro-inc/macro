import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import type { SettingsTab } from '@core/constant/SettingsState';
import type { SettingsTabGroup } from '@core/constant/settingsTabsConfig';
import SignOutIcon from '@phosphor/sign-out.svg';
import { pressHandlers } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { SettingsSearchResult } from '../core/settings-search';
import { SettingsSearchResults } from './settings-search-results';

/**
 * Settings' inner navigation, laid out like every other view's sidebar: a
 * title bar, a search field, the grouped section pills, and Log out pinned to
 * the bottom.
 */
export function SettingsSidebar(props: {
  groups: SettingsTabGroup[];
  results: SettingsSearchResult[];
  selectedResultId?: string;
  onSelectResult: (result: SettingsSearchResult) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isItemActive: (tab: SettingsTab) => boolean;
  onSelect: (tab: SettingsTab) => void;
  onLogout: () => void;
}) {
  let root: HTMLDivElement | undefined;
  return (
    <ViewSidebar.Root ref={root} aria-label="Settings navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>Settings</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>

      <ViewSidebar.Primary>
        <SearchBar
          label="Search settings"
          placeholder="Search settings"
          autocomplete="off"
          value={props.searchQuery}
          onValueChange={props.onSearchQueryChange}
          class="border-0 bg-ink/5 shadow-none"
          onEscape={() => props.onSearchQueryChange('')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              const first =
                root?.querySelector<HTMLButtonElement>('nav button');
              if (first) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
        />
      </ViewSidebar.Primary>

      <ViewSidebar.Content>
        <Show
          when={!props.searchQuery.trim()}
          fallback={
            <SettingsSearchResults
              results={props.results}
              selectedId={props.selectedResultId}
              onSelect={props.onSelectResult}
            />
          }
        >
          <Show
            when={props.groups.length > 0}
            fallback={
              <div class="py-4 text-center text-sm text-ink-muted">
                No settings found
              </div>
            }
          >
            <For each={props.groups}>
              {(group) => (
                <section class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="flex h-7 min-w-0 items-center px-(--sidebar-item-inset) text-xs font-medium text-ink/50">
                    <span class="truncate">{group.label}</span>
                  </h2>
                  <ViewSidebar.Nav aria-label={group.label}>
                    <For each={group.items}>
                      {(item) => (
                        <ViewSidebar.Item
                          active={props.isItemActive(item.tab)}
                          class="text-ink"
                          {...pressHandlers(() => props.onSelect(item.tab))}
                        >
                          <ViewSidebar.Icon>
                            <Dynamic component={item.icon} class="size-4" />
                          </ViewSidebar.Icon>
                          <span class="truncate">{item.label}</span>
                        </ViewSidebar.Item>
                      )}
                    </For>
                  </ViewSidebar.Nav>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </ViewSidebar.Content>

      <ViewSidebar.Footer class="py-(--sidebar-gutter)">
        <ViewSidebar.Item {...pressHandlers(() => props.onLogout())}>
          <ViewSidebar.Icon>
            <SignOutIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Log out</span>
        </ViewSidebar.Item>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}
