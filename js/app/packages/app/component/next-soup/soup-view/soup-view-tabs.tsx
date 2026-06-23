import {
  getViewPreset,
  type PresetContext,
  VIEW_TAB_PRESETS,
} from '@app/component/app-sidebar/soup-filter-presets';
import { PillTabs } from '@app/component/mobile/PillTabs';
import type { FilterID } from '@app/component/next-soup/filters';
import type { FilterContext } from '@app/component/next-soup/filters/configs';
import {
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { mergeQuery } from '@app/component/next-soup/filters/filter-store/query-store';
import { useSoup } from '@app/component/next-soup/soup-context';
import { MobileFilterDrawer } from '@app/component/next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { TabsInsetDropdown } from '@core/component/TabsInsetDropdown';
import { useUserContext } from '@core/context/user';
import { useIsTeamAdmin } from '@queries/team/teams';
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
  | 'companies'
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
    { value: 'folders', label: 'Folders' },
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
    { value: 'missed', label: 'Missed' },
    { value: 'unattended', label: 'Unattended' },
  ],
  companies: [
    { value: 'active', label: 'Active' },
    // The 'hidden' tab is gated to admin/owner team members — see
    // `filterTabsForUser` below and the preset resolver in
    // soup-filter-presets.ts.
    { value: 'hidden', label: 'Hidden' },
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

const PRESERVE_FILTERS_ON_TAB_CHANGE: ListView[] = ['documents', 'tasks'];

export const shouldPreserveFiltersOnTabChange = (view: ListView) =>
  PRESERVE_FILTERS_ON_TAB_CHANGE.includes(view);

export const useApplyPreset = () => {
  const soup = useSoup();
  const { queryFilters, setActiveTab, activeTab, assigneeFilter } =
    useSoupView();
  const user = useUserContext();
  const isTeamAdmin = useIsTeamAdmin();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
    isTeamAdmin: isTeamAdmin(),
  });

  const getFilterQuery = (id: string, ctx: FilterContext) => {
    const filter = soup.predicates.getConfig(id);
    if (!filter?.query) return undefined;

    return typeof filter.query === 'function'
      ? (filter.query as (ctx: FilterContext) => Query)(ctx)
      : (filter.query as Query);
  };

  const applyTabPreset = (view: ListView, tabId: string) => {
    const presetContext = getPresetContext();
    const preset = getViewPreset(view, tabId, presetContext);
    if (!preset) return false;

    const filterContext: FilterContext = {
      userId: presetContext.userId,
      assignees: assigneeFilter(),
    };

    let nextFilters = preset.filters;
    let nextClientFilters = preset.clientFilters;

    if (shouldPreserveFiltersOnTabChange(view)) {
      const currentPreset = getViewPreset(
        view,
        activeTab() ?? VIEW_TAB_PRESETS[view]?.default,
        presetContext
      );

      const currentFilterIds: FilterID[] = [
        ...(currentPreset?.clientFilters.and ?? []),
        ...(currentPreset?.clientFilters.or ?? []),
      ];

      const nextAndIds = (soup.predicates.andIds() as FilterID[]).filter(
        (id) => !currentFilterIds.includes(id)
      );

      const nextOrIds = (soup.predicates.orIds() as FilterID[]).filter(
        (id) => !currentFilterIds.includes(id)
      );

      const refinementIds = [...nextAndIds, ...nextOrIds];

      let mergedFilters = queryStateFrom(preset.filters);
      for (const id of refinementIds) {
        const query = getFilterQuery(id, filterContext);

        if (!query) continue;

        mergedFilters = mergeQuery(mergedFilters, query);
      }

      nextFilters = mergedFilters;

      nextClientFilters = {
        and: [...new Set([...(preset.clientFilters.and ?? []), ...nextAndIds])],
        or: [...new Set([...(preset.clientFilters.or ?? []), ...nextOrIds])],
      };
    }

    batch(() => {
      setActiveTab(tabId);
      queryFilters.replace(nextFilters);
      soup.predicates.set(nextClientFilters);
      soup.grouping.setActiveGroupId(preset.groupBy);
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

/** Drops admin-only tabs for non-admin users (currently: companies → hidden). */
function filterTabsForUser(
  view: TabbedListView,
  list: TabItem[],
  isTeamAdmin: boolean
): TabItem[] {
  if (view === 'companies' && !isTeamAdmin) {
    return list.filter((t) => t.value !== 'hidden');
  }
  return list;
}

const ViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const isTeamAdmin = useIsTeamAdmin();
  const list = () =>
    filterTabsForUser(props.view, VIEW_TAB_LISTS[props.view], isTeamAdmin());

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
  const isTeamAdmin = useIsTeamAdmin();

  const view = createMemo(() => {
    const v = listView();
    return v && v in VIEW_TAB_LISTS ? (v as TabbedListView) : undefined;
  });

  const list = createMemo(() => {
    const v = view();
    return v ? filterTabsForUser(v, VIEW_TAB_LISTS[v], isTeamAdmin()) : [];
  });

  const defaultValue = createMemo(() => {
    const v = view();
    return v ? VIEW_TAB_PRESETS[v].default : undefined;
  });

  return (
    <TabsInsetDropdown
      list={list()}
      value={activeTab()}
      defaultValue={defaultValue()}
      onChange={(value) => {
        const v = view();
        if (v) {
          applyTabPreset(v, value);
        }
      }}
    />
  );
};

export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <div class="flex items-center px-(--mobile-chrome-gutter)">
      <MobileFilterDrawer />
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
  const isTeamAdmin = useIsTeamAdmin();
  const list = () =>
    filterTabsForUser(props.view, VIEW_TAB_LISTS[props.view], isTeamAdmin());
  const activeValue = () => activeTab() ?? VIEW_TAB_PRESETS[props.view].default;

  return (
    <PillTabs
      class="pl-2"
      items={list()}
      value={activeValue()}
      onChange={(value) => applyTabPreset(props.view, value)}
    />
  );
};
