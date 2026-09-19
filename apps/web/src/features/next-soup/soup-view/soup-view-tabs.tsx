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
import { MobileSearchFilterDrawer } from '@app/features/next-soup/soup-view/filters-bar/search/mobile-search-filter-drawer';
import {
  type SoupViewMode,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import {
  type TabbedListView,
  VIEW_TAB_LISTS,
} from '@app/features/next-soup/soup-view/tab-lists';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { TabsInsetDropdown } from '@core/component/TabsInsetDropdown';
import { enableReminders } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { useIsTeamAdmin } from '@queries/team/teams';
import { batch, createMemo, For, Match, Show, Switch } from 'solid-js';

const useCurrentListView = () => {
  const panel = useSplitPanelOrThrow();

  return createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return isListViewID(content.id) ? content.id : undefined;
  });
};

/**
 * Tabs actually shown for a view. `VIEW_TAB_LISTS` is the full superset (the
 * tab/preset consistency tests key off it); flag-gated entries are dropped
 * here so every tab surface — segmented control, collapsed dropdown, mobile
 * pills, and the number/cycle hotkeys — agrees on which tabs exist.
 */
export const useVisibleViewTabs = () => {
  const remindersFlag = useFeatureFlag(enableReminders);

  return (view: TabbedListView): TabItem[] =>
    view === 'inbox' && !remindersFlag().enabled
      ? VIEW_TAB_LISTS.inbox.filter((tab) => tab.value !== 'reminders')
      : VIEW_TAB_LISTS[view];
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

      // Created by is a direct server-side document-owner refinement rather
      // than a client predicate, so retain an explicit choice across the
      // Tasks and Files tabs just as we do tags above. Do not carry a tab's
      // own owner scope (e.g. Files → Owned) into another tab.
      const currentCreatorIds =
        queryFilters.state.include.documentOwnerId ?? [];
      const presetCreatorIds =
        currentPreset?.filters.include?.documentOwnerId ?? [];
      const isExplicitCreatorFilter =
        currentCreatorIds.length !== presetCreatorIds.length ||
        currentCreatorIds.some((id) => !presetCreatorIds.includes(id));
      if (isExplicitCreatorFilter) {
        mergedFilters.include.documentOwnerId = currentCreatorIds.length
          ? [...currentCreatorIds]
          : undefined;
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
  const visibleViewTabs = useVisibleViewTabs();

  return (
    <TabsInset
      list={visibleViewTabs(props.view)}
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
  const visibleViewTabs = useVisibleViewTabs();

  const view = createMemo(() => {
    const v = listView();
    return v && v in VIEW_TAB_LISTS ? (v as TabbedListView) : undefined;
  });

  const list = createMemo(() => {
    const v = view();
    return v ? visibleViewTabs(v) : [];
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

/**
 * Filter-drawer button + per-view filter pills, rendered in the mobile split
 * header. The strip is full-bleed: negative margins cancel the header row's
 * gutter so pills scroll to the device edges, and the gutter travels inside
 * the scroll content. The drawer button leads the strip and scrolls along
 * with the pills.
 */
export const MobileSoupViewTabs = () => {
  const listView = useCurrentListView();

  return (
    <Switch>
      <Match when={listView() === 'search'}>
        {/* The search view has no tab pills — its header hosts only the
            facet-filter drawer button (the desktop SearchFiltersRow's
            mobile counterpart). */}
        <MobileSearchFilterDrawer />
      </Match>
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
  );
};

// Full-bleed breakout for header strips: the strip sits in the header row's
// left flex slot, whose right edge stops short of the panel edge (row gap +
// right-side column), so sizing it there leaves a sliver the pills can't
// scroll over (right where the list's scrollbar sits). Instead, opt out of
// flex sizing and span the header container itself (100cqw resolves against
// @container/split-header = the panel width): -ml cancels the row gutter so
// the strip runs device edge to device edge, over the scrollbar.
const MOBILE_TAB_STRIP_CLASS =
  '-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none';
const MOBILE_TAB_CONTENT_CLASS = 'px-(--mobile-chrome-gutter)';

const MobileCompanyModeTabs = () => {
  const { viewMode, setViewMode } = useSoupView();

  return (
    <PillTabs
      scrollable
      class={MOBILE_TAB_STRIP_CLASS}
      contentClass={MOBILE_TAB_CONTENT_CLASS}
      leading={<MobileFilterDrawer />}
      items={COMPANY_MODE_TABS}
      value={viewMode()}
      onChange={(value) => setViewMode(value as SoupViewMode)}
    />
  );
};

const MobileViewTabs = (props: { view: TabbedListView }) => {
  const { applyTabPreset } = useApplyPreset();
  const { activeTab } = useSoupView();
  const visibleViewTabs = useVisibleViewTabs();
  const activeValue = () => activeTab() ?? VIEW_TAB_PRESETS[props.view].default;

  return (
    <PillTabs
      scrollable
      class={MOBILE_TAB_STRIP_CLASS}
      contentClass={MOBILE_TAB_CONTENT_CLASS}
      leading={<MobileFilterDrawer />}
      items={visibleViewTabs(props.view)}
      value={activeValue()}
      onChange={(value) => applyTabPreset(props.view, value)}
    />
  );
};

export { type TabbedListView, VIEW_TAB_LISTS };
