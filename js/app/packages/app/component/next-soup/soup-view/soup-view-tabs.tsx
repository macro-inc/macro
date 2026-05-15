import {
  getViewPreset,
  type PresetContext,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { type TabItem, Tabs } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { useUserContext } from '@core/context/user';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import { Dropdown, Layer } from '@ui';
import { batch, createMemo, For, Match, Switch } from 'solid-js';

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
    { value: 'calendar', label: 'Calendar' },
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
  const { queryFilters, setActiveTab } = useSoupView();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const applyTabPreset = (view: ListView, tabId: string): boolean => {
    const preset = getViewPreset(view, tabId, getPresetContext());
    if (!preset) return false;

    batch(() => {
      setActiveTab(tabId);
      queryFilters.replace(preset.filters);
      soup.predicates.set(preset.clientFilters);
    });
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
    <TabsInset
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
    <Dropdown placement="bottom-start" gutter={4}>
      <Dropdown.Trigger class="flex items-center gap-1">
        <span class="truncate">{activeLabel()}</span>
        <ChevronDownIcon class="size-3 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Layer depth={2}>
          <Dropdown.Content class="z-action-menu bg-surface border border-edge-muted rounded-sm shadow-sm p-1">
            <For each={list()}>
              {(item) => (
                <Dropdown.Item
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
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Layer>
      </Dropdown.Portal>
    </Dropdown>
  );
};

export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <div class="bg-surface border-t border-edge-muted h-11 px-1">
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
      class="**:data-indicator:h-0.75"
    />
  );
};
