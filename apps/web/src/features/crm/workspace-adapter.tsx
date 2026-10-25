import { usePreference } from '@app/preferences/use-preference';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useSettingsState } from '@core/constant/SettingsState';
import { idToDisplayName } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import { type EntityData, isCrmCompanyEntity } from '@entity';
import { COMPANY_STAGE_OPTIONS } from '@entity/utils/task-properties';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { batch, createEffect, createRenderEffect, on, untrack } from 'solid-js';
import type { Query } from '../next-soup/filters/filter-store';
import type { SetPredicatesInput } from '../next-soup/filters/filter-store/predicates-store';
import {
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '../next-soup/sidebar/soup-filter-presets';
import { useSoup } from '../next-soup/soup-context';
import { createSoupViewState } from '../next-soup/soup-view/soup-view-context';
import { useSoupFilterPersistence } from '../next-soup/use-soup-filter-persistence';
import { openEntityInSplitFromUnifiedList } from '../next-soup/utils';
import type { CrmContext } from './context/crm-context';
import type { DealStages } from './context/crm-sources';
import type { CrmRoute, CrmWorkspace } from './context/workspace-context';
import type { CrmViewConfig } from './core/saved-view';
import { createCrmCollectionFilters } from './filter-adapter';
import { COMPANY_GROUP_OPTIONS } from './group-options';
import { createSettingsPage } from './primitives/settings-page';

// The filter context lands in cached soup query meta, so its stage resolvers
// close over the deal stages only, never this workspace's scope (see "Query
// callback lifetimes" in apps/web/AGENTS.md).
function stageFilterResolvers(stages: DealStages) {
  return {
    resolveCompanyStage: (entity: EntityData) =>
      isCrmCompanyEntity(entity) ? stages.resolveStage(entity) : undefined,
    companyStageLabel: stages.stageLabel,
  };
}

function resolveInitialGroupBy(
  initialCrmView: CrmViewConfig | undefined,
  persistedGroupBy: string | null | undefined,
  fallbackPreset: ReturnType<typeof getViewPreset>
) {
  if (initialCrmView) return initialCrmView.groupBy ?? undefined;
  if (persistedGroupBy != null) return persistedGroupBy;
  return fallbackPreset?.groupBy;
}

function applySharedSubFilters(
  initialCrmView: CrmViewConfig,
  soupView: {
    setStageFilter(stages: string[]): void;
    setOwnerFilter(owners: string[]): void;
  },
  predicates: {
    isActive(id: string): boolean;
    toggle(input: { and: string[] }): void;
  }
) {
  const stages = initialCrmView.stageFilter ?? [];
  soupView.setStageFilter(stages);
  if (stages.length > 0 !== predicates.isActive('company-stage')) {
    predicates.toggle({ and: ['company-stage'] });
  }
  const owners = initialCrmView.ownerFilter ?? [];
  soupView.setOwnerFilter(owners);
  if (owners.length > 0 !== predicates.isActive('company-owner')) {
    predicates.toggle({ and: ['company-owner'] });
  }
}

export function createCrmWorkspace(
  crm: CrmContext,
  route: CrmRoute,
  sharedView?: CrmViewConfig
) {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();
  const stages = crm.createDealStages();
  const stageResolvers = stageFilterResolvers(stages);
  const [persistFilters] = useSoupFilterPersistence();
  const filters = createCrmCollectionFilters(crm, soup, persistFilters, stages);
  const state = createSoupViewState({
    filterPersistence: persistFilters,
    soup,
    extensions: {
      propertyGrouping: {
        value: (entity, id) =>
          id === SYSTEM_PROPERTY_IDS.STAGE
            ? (stageResolvers.resolveCompanyStage(entity) ?? '')
            : undefined,
        label: (value, id) =>
          id === SYSTEM_PROPERTY_IDS.STAGE
            ? stages.stageLabel(value)
            : id === SYSTEM_PROPERTY_IDS.COMPANY_OWNER
              ? idToDisplayName(value) || undefined
              : undefined,
        order: (id) =>
          id === SYSTEM_PROPERTY_IDS.STAGE
            ? stages.stages().map((stage) => stage.id)
            : COMPANY_STAGE_OPTIONS.map((option) => String(option.value)),
      },
      filterContext: () => ({
        ...stageResolvers,
        owners: filters.state.ownerFilter(),
        stages: filters.state.stageFilter(),
      }),
      selectFilters: filters.facets,
      groupOptions: {
        visible: () => true,
        options: COMPANY_GROUP_OPTIONS,
      },
    },
  });
  const soupView = { ...state.context, ...filters.state };
  const preset = getViewPreset('companies');
  const initialUrlTab = untrack(() => {
    const tab = route.tab();
    return tab !== VIEW_TAB_PRESETS.companies.default ? tab : undefined;
  });
  // A record link names its list; nothing may move it off the record.
  const initialRecordOpen = untrack(() => route.records().length > 0);
  const initialTabPreset =
    initialUrlTab && initialUrlTab in VIEW_TAB_PRESETS.companies.tabs
      ? getViewPreset('companies', initialUrlTab)
      : undefined;
  const entryState = panel.handle.currentEntryState();

  const persistedFilters = entryState?.['search.filters'] as Query | undefined;

  const persistedPredicates = entryState?.['search.predicates'] as
    | SetPredicatesInput<string>
    | undefined;

  const persistedSearchText = entryState?.['search.text'] as string | undefined;

  const persistedGroupBy = entryState?.['soup.groupBy'] as
    | string
    | null
    | undefined;

  const persistedActiveTab = entryState?.['soup.tab'] as string | undefined;

  const persistedCollapsedGroups = entryState?.['soup.collapsedGroups'] as
    | string[]
    | undefined;

  const [sortPref, setSortPref] = usePreference<string[]>(
    'macro:pref:soup:companies:sort',
    { default: [] }
  );
  const initialCrmView = sharedView;

  // A default saved view only applies to a fresh Customers entry. Restored
  // entries, share links, record links, and an explicit URL tab keep their own state.
  const applyDefaultCrmView =
    initialCrmView === undefined &&
    initialUrlTab === undefined &&
    !initialRecordOpen &&
    persistedFilters === undefined &&
    persistedPredicates === undefined;

  const fallbackPreset = initialTabPreset ?? preset;
  const initialActiveTab = initialRecordOpen
    ? untrack(route.tab)
    : (initialCrmView?.activeTab ??
      initialUrlTab ??
      persistedActiveTab ??
      VIEW_TAB_PRESETS.companies.default);
  const initialGroupBy = resolveInitialGroupBy(
    initialCrmView,
    persistedGroupBy,
    fallbackPreset
  );

  // Restore before child controls mount; shared links take precedence over storage.
  let init = false;
  createRenderEffect(() => {
    if (init) return;
    init = true;
    batch(() => {
      soupView.initialize({
        initialQuery: initialCrmView
          ? (initialCrmView.filters as Query | undefined)
          : (persistedFilters ?? fallbackPreset?.filters),
        initialClientFilters: initialCrmView
          ? (initialCrmView.clientFilters ?? {})
          : (persistedPredicates ?? fallbackPreset?.clientFilters),
        initialSearchText: initialCrmView
          ? (initialCrmView.searchText ?? '')
          : persistedSearchText,
        preferInitialFilters:
          initialCrmView !== undefined || initialTabPreset !== undefined,
      });

      const sortIds = initialCrmView?.sort ?? sortPref();
      const initialSortIds = sortIds.length > 0 ? sortIds : ['updated_at'];

      soup.grouping.setActiveGroupId(initialGroupBy);
      soup.grouping.collapseAll(persistedCollapsedGroups ?? []);
      soup.sort.setAll(
        initialSortIds as Parameters<typeof soup.sort.setAll>[0]
      );

      soupView.setActiveTab(initialActiveTab);
      if (initialActiveTab !== untrack(route.tab)) {
        route.setTab(initialActiveTab, { replace: true });
      }

      if (initialCrmView) {
        applySharedSubFilters(initialCrmView, soupView, soup.predicates);
      }
    });
  });

  createEffect(
    on(
      route.tab,
      (urlTab) => {
        const target = urlTab || VIEW_TAB_PRESETS.companies.default;
        const current =
          untrack(soupView.activeTab) ?? VIEW_TAB_PRESETS.companies.default;
        if (target === current) return;
        batch(() => {
          soupView.setActiveTab(target);
          if (target in VIEW_TAB_PRESETS.companies.tabs) {
            const tabPreset = getViewPreset('companies', target);
            if (tabPreset) {
              soupView.queryFilters.replace(tabPreset.filters);
              soup.predicates.set(tabPreset.clientFilters);
              soup.grouping.setActiveGroupId(tabPreset.groupBy);
            }
          }
        });
      },
      { defer: true }
    )
  );

  createEffect(() => {
    panel.handle.setDisplayName('Customers');
  });

  // Bridge live soup sort state back to preferences. `defer: true` skips the
  // initial run on mount, so we only write when the user actually changes it.
  createEffect(
    on(
      () => soup.sort.active().map((s) => s.id),
      (ids) => setSortPref(ids),
      { defer: true }
    )
  );

  let replaceNextTab = false;
  const withReplaceHistory = (apply: () => void) => {
    replaceNextTab = true;
    try {
      apply();
    } finally {
      replaceNextTab = false;
    }
  };
  const setActiveTab = (
    next?: string | ((prev: string | undefined) => string | undefined)
  ) => {
    const previous =
      untrack(soupView.activeTab) ?? VIEW_TAB_PRESETS.companies.default;
    const resolved = soupView.setActiveTab(next);
    const target =
      (typeof next === 'function' ? resolved : next) ??
      VIEW_TAB_PRESETS.companies.default;
    if (target !== untrack(route.tab)) {
      route.setTab(target, { replace: replaceNextTab || target === previous });
    }
    return resolved;
  };
  // Setter<string | undefined> has a zero-argument overload a wrapper cannot match.
  const wrappedSetActiveTab = setActiveTab as CrmWorkspace['setActiveTab'];
  state.context.setActiveTab = wrappedSetActiveTab;

  const { openSettings } = useSettingsState();
  const settings = createSettingsPage(() =>
    [
      route.tab(),
      ...route.records().map((record) => `${record.type}:${record.id}`),
      route.section() ?? '',
      route.commentTarget()?.seek ?? '',
    ].join(' ')
  );
  const context: CrmWorkspace = {
    ...soupView,
    setActiveTab: wrappedSetActiveTab,
    host: {
      scopeId: panel.splitHotkeyScope,
      isActive: panel.isPanelActive,
      focus: () => panel.panelRef()?.focus(),
      captureEntryState: () => panel.handle.captureEntryState(),
      openCompany: (entity, newSplit) => {
        fireAndForget(
          openEntityInSplitFromUnifiedList(entity, {
            openInNewSplit: newSplit,
            splitHandle: panel.handle,
            referredFrom: 'companies',
          }),
          'open-entity-in-split'
        );
      },
      settings: {
        ...settings,
        open: () => {
          // The list unmounts; its entry keeps the scroll position for the return.
          panel.handle.captureEntryState();
          settings.open();
        },
      },
      openTeamSettings: () => openSettings('Team'),
      record: route,
    },
  };
  return { state, context, applyDefaultCrmView, withReplaceHistory };
}
