import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { useUserContext } from '@core/context/user';
import { Tabs, type TabItem } from '@core/component/Tabs';
import { batch, createMemo, For, Match, Switch } from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import ChevronDownIcon from '@icon/regular/caret-down.svg';

/** Views that have tab definitions. Shared between VIEW_TAB_LISTS and VIEW_TAB_PRESETS. */
export type TabbedListView = Extract<
  ListView,
  | 'inbox'
  | 'agents'
  | 'mail'
  | 'documents'
  | 'tasks'
  | 'channels'
  | 'calls'
  | 'folders'
>;

/** Tab definitions for each list view. */
export const VIEW_TAB_LISTS: Record<TabbedListView, TabItem[]> = {
  inbox: [
    { value: 'signal', label: 'Signal' },
    { value: 'noise', label: 'Noise' },
    { value: 'all', label: 'All' },
  ],
  agents: [
    { value: 'owned', label: 'Owned' },
    { value: 'running', label: 'Running' },
    { value: 'shared', label: 'Shared' },
    { value: 'automations', label: 'Automations' },
  ],
  mail: [
    { value: 'important', label: 'Signal' },
    { value: 'noise', label: 'Noise' },
    { value: 'sent', label: 'Sent' },
    { value: 'drafts', label: 'Drafts' },
    { value: 'shared', label: 'Shared' },
    { value: 'all', label: 'All' },
  ],
  documents: [
    { value: 'owned', label: 'Owned' },
    { value: 'shared', label: 'Shared' },
    { value: 'attachments', label: 'Attachments' },
    { value: 'all', label: 'All' },
  ],
  tasks: [
    { value: 'assigned-to-me', label: 'Assigned' },
    { value: 'created-by-me', label: 'Created' },
    { value: 'all', label: 'All' },
  ],
  channels: [
    { value: 'recent', label: 'Recent' },
    { value: 'people', label: 'People' },
    { value: 'teams', label: 'Teams' },
  ],
  calls: [
    { value: 'all', label: 'All' },
    { value: 'unattended', label: 'Unattended' },
  ],
  folders: [
    { value: 'owned', label: 'Owned' },
    { value: 'all', label: 'All' },
  ],
};

const useCurrentListView = () => {
  const panel = useSplitPanelOrThrow();

  return createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return isListViewID(content.id) ? content.id : undefined;
  });
};

export const useApplyPreset = () => {
  const soup = useSoup();
  const { setQueryFilters, setActiveTab } = useSoupView();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const applyPreset = (preset: {
    queryFilters: SoupItemsQueryFilters;
    clientFilters: { and?: FilterID[]; or?: FilterID[] };
  }) => {
    batch(() => {
      setQueryFilters(preset.queryFilters);
      soup.filters.set(preset.clientFilters);
    });
  };

  const applyTabPreset = (view: ListView, tabId: string): boolean => {
    const config = VIEW_TAB_PRESETS[view];
    if (!config) return false;
    const resolver = config.tabs[tabId];
    if (!resolver) return false;

    const resolved = resolver(getPresetContext());
    if (!resolved) return false;

    setActiveTab(tabId);
    applyPreset(resolved);
    return true;
  };

  return { applyTabPreset };
};

export const SoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <Switch>
      <For each={Object.keys(VIEW_TAB_LISTS) as TabbedListView[]}>
        {(v) => (
          <Match when={listView() === v}>
            <ViewTabs view={v} />
          </Match>
        )}
      </For>
    </Switch>
  );
};

const ViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const list = () => VIEW_TAB_LISTS[props.view];

  return (
    <Tabs
      list={list()}
      value={activeTab()}
      defaultValue={VIEW_TAB_PRESETS[props.view].default}
      onChange={(value) => applyTabPreset(props.view, value)}
    />
  );
};

/** Compact dropdown variant of tabs, used when the header is too narrow for the full segmented control. */
export const CollapsedSoupViewTabs = () => {
  const listView = useCurrentListView();
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  const list = createMemo(() => {
    const view = listView();
    if (!view || !(view in VIEW_TAB_LISTS)) return [];
    return VIEW_TAB_LISTS[view as TabbedListView];
  });

  const activeLabel = createMemo(() => {
    const tab = activeTab();
    return list().find((item) => item.value === tab)?.label ?? list()[0]?.label;
  });

  return (
    <DropdownMenu placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger class="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs border border-edge-muted hover:bg-ink/6 transition-colors">
        <span class="truncate">{activeLabel()}</span>
        <ChevronDownIcon class="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-sm p-1">
          <For each={list()}>
            {(item) => (
              <DropdownMenu.Item
                class="w-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                classList={{
                  'font-semibold': activeTab() === item.value,
                }}
                onSelect={() => {
                  const view = listView();
                  if (view) applyTabPreset(view, item.value);
                }}
              >
                {item.label}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
};

export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <div class="bg-panel border-t border-edge-muted h-11 px-1">
      <Switch>
        <For
          each={Object.keys(VIEW_TAB_LISTS) as (keyof typeof VIEW_TAB_LISTS)[]}
        >
          {(v) => (
            <Match when={listView() === v}>
              <MobileViewTabs view={v} />
            </Match>
          )}
        </For>
      </Switch>
    </div>
  );
};

const MobileViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const list = () => VIEW_TAB_LISTS[props.view];

  return (
    <Tabs
      list={list()}
      value={activeTab()}
      defaultValue={VIEW_TAB_PRESETS[props.view].default}
      onChange={(value) => applyTabPreset(props.view, value)}
      indicatorPosition="top"
      class="[&_[data-indicator]]:h-[3px]"
    />
  );
};
