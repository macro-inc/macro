import { isListViewID, type ListView } from '@app/constants/list-views';
import type { FilterID } from '@app/features/next-soup/filters';
import type { FilterContext } from '@app/features/next-soup/filters/configs';
import {
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import {
  getViewPreset,
  type PresetContext,
  VIEW_TAB_PRESETS,
} from '@app/features/next-soup/sidebar/soup-filter-presets';
import { useSoup } from '@app/features/next-soup/soup-context';
import { MobileFilterDrawer } from '@app/features/next-soup/soup-view/filters-bar/mobile-filter-drawer';
import {
  type SoupViewMode,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { TabsInsetDropdown } from '@core/component/TabsInsetDropdown';
import { useUserContext } from '@core/context/user';
import { useIsTeamAdmin } from '@queries/team/teams';
import { batch, createMemo, For, Match, Show, Switch } from 'solid-js';

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
    { value: 'calendar', label: 'Calendar' },
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
  const panel = useSplitPanelOrThrow();
  const {
    queryFilters,
    restorePersistedQueryFilters,
    restorePersistedPredicates,
    setActiveTab,
    activeTab,
    assigneeFilter,
  } = useSoupView();
  const user = useUserContext();
  const isTeamAdmin = useIsTeamAdmin();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
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

      // Tags are a query-only refinement with no backing predicate, so the
      // predicate-driven reconstruction above never carries them. Preserve the
      // active selection (and its combine mode) explicitly like any other
      // refinement.
      const activeTagFilters = queryFilters.state.include.tagFilters;
      if (activeTagFilters?.length) {
        mergedFilters = mergeQuery(mergedFilters, {
          include: {
            tagFilters: activeTagFilters.map((t) => ({ ...t })),
            tagFilterMode: queryFilters.state.include.tagFilterMode,
          },
        });
      }

      nextFilters = mergedFilters;

      nextClientFilters = {
        and: [...new Set([...(preset.clientFilters.and ?? []), ...nextAndIds])],
        or: [...new Set([...(preset.clientFilters.or ?? []), ...nextOrIds])],
      };
    }

    batch(() => {
      setActiveTab(tabId);
      if (!restorePersistedQueryFilters(tabId)) {
        queryFilters.replace(nextFilters);
      }
      if (!restorePersistedPredicates(tabId)) {
        soup.predicates.set(nextClientFilters);
      }
      soup.grouping.setActiveGroupId(preset.groupBy);
    });

    // The new tab replaces the dataset wholesale, and row focus only follows
    // a row that survives into it (see soup.setRows). When it doesn't,
    // nothing is selected anymore, so the Preview Pair's Viewer returns to
    // its placeholder instead of lingering on the previous tab's entity.
    const focusedRow = soup.focus.row();
    if (
      !focusedRow ||
      focusedRow.getIsGrouped() ||
      focusedRow.getIsLoadMore()
    ) {
      panel.handle.resetPreview();
    }
    return true;
  };

  return { applyTabPreset };
};

export const SoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <Switch>
      <Match when={listView() === 'companies'}>
        <CompanyModeTabs />
      </Match>
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

/** The Customers view swaps filter tabs for a board/list mode switch. */
const COMPANY_MODE_TABS: TabItem[] = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
];

const CompanyModeTabs = () => {
  const { viewMode, setViewMode } = useSoupView();

  return (
    <TabsInset
      list={COMPANY_MODE_TABS}
      value={viewMode()}
      defaultValue="board"
      onChange={(value) => setViewMode(value as SoupViewMode)}
    />
  );
};

const ViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();

  return (
    <TabsInset
      list={VIEW_TAB_LISTS[props.view]}
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
  const { activeTab, viewMode, setViewMode } = useSoupView();

  const view = createMemo(() => {
    const v = listView();
    return v && v in VIEW_TAB_LISTS ? (v as TabbedListView) : undefined;
  });

  const list = createMemo(() => {
    const v = view();
    return v ? VIEW_TAB_LISTS[v] : [];
  });

  const defaultValue = createMemo(() => {
    const v = view();
    return v ? VIEW_TAB_PRESETS[v].default : undefined;
  });

  return (
    <Show
      when={listView() !== 'companies'}
      fallback={
        <TabsInsetDropdown
          list={COMPANY_MODE_TABS}
          value={viewMode()}
          defaultValue="board"
          onChange={(value) => setViewMode(value as SoupViewMode)}
        />
      }
    >
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
    </Show>
  );
};

export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <div class="flex items-center px-(--mobile-chrome-gutter)">
      <MobileFilterDrawer />
      <Switch>
        <Match when={listView() === 'companies'}>
          <MobileCompanyModeTabs />
        </Match>
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

const MobileCompanyModeTabs = () => {
  const { viewMode, setViewMode } = useSoupView();

  return (
    <PillTabs
      class="pl-2"
      items={COMPANY_MODE_TABS}
      value={viewMode()}
      onChange={(value) => setViewMode(value as SoupViewMode)}
    />
  );
};

const MobileViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const activeValue = () => activeTab() ?? VIEW_TAB_PRESETS[props.view].default;

  return (
    <PillTabs
      class="pl-2"
      items={VIEW_TAB_LISTS[props.view]}
      value={activeValue()}
      onChange={(value) => applyTabPreset(props.view, value)}
    />
  );
};
