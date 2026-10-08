import { usePreference } from '@app/preferences/use-preference';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useSettingsState } from '@core/constant/SettingsState';
import { idToDisplayName } from '@core/user/util';
import { isCrmCompanyEntity } from '@entity';
import { COMPANY_STAGE_OPTIONS } from '@entity/utils/task-properties';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { batch, createEffect, createRenderEffect, on } from 'solid-js';
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
import type { CrmWorkspace } from './context/workspace-context';
import type { CrmViewConfig } from './core/saved-view';
import { createCrmCollectionFilters } from './filter-adapter';
import { COMPANY_GROUP_OPTIONS } from './group-options';

export function createCrmWorkspace(
  crm: CrmContext,
  sharedView?: CrmViewConfig
) {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();
  const stages = crm.createDealStages();
  const resolveStage = (entity: import('@entity').EntityData) =>
    isCrmCompanyEntity(entity) ? stages.resolveStage(entity) : undefined;
  const [persistFilters] = useSoupFilterPersistence();
  const filters = createCrmCollectionFilters(crm, soup, persistFilters, stages);
  const state = createSoupViewState({
    filterPersistence: persistFilters,
    soup,
    extensions: {
      propertyGrouping: {
        value: (entity, id) =>
          id === SYSTEM_PROPERTY_IDS.STAGE
            ? (resolveStage(entity) ?? '')
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
        resolveCompanyStage: resolveStage,
        companyStageLabel: stages.stageLabel,
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

  // A default saved view only applies to a fresh Customers entry: restored
  // (back/forward) entries keep what the user was looking at, and share
  // links carry their own state.
  const applyDefaultCrmView =
    initialCrmView === undefined &&
    persistedFilters === undefined &&
    persistedPredicates === undefined;

  // Restore before child controls mount; shared links take precedence over storage.
  let init = false;
  createRenderEffect(() => {
    if (init) return;
    init = true;
    batch(() => {
      soupView.initialize({
        initialQuery: initialCrmView
          ? (initialCrmView.filters as Query | undefined)
          : (persistedFilters ?? preset?.filters),
        initialClientFilters: initialCrmView
          ? (initialCrmView.clientFilters ?? {})
          : (persistedPredicates ?? preset?.clientFilters),
        initialSearchText: initialCrmView
          ? (initialCrmView.searchText ?? '')
          : persistedSearchText,
        preferInitialFilters: initialCrmView !== undefined,
      });

      // `groupBy: null` in a shared view records an explicit "no grouping",
      // which the grouping store expresses as `undefined`.
      const initialGroupBy = initialCrmView
        ? (initialCrmView.groupBy ?? undefined)
        : (persistedGroupBy ?? preset?.groupBy);

      let initialSortIds = initialCrmView?.sort ?? sortPref();
      if (initialSortIds.length === 0) {
        initialSortIds = ['updated_at'];
      }

      const initialActiveTab =
        initialCrmView?.activeTab ??
        persistedActiveTab ??
        soupView.getPersistedActiveTab('companies') ??
        VIEW_TAB_PRESETS.companies.default;

      soup.grouping.setActiveGroupId(initialGroupBy);
      soup.grouping.collapseAll(persistedCollapsedGroups ?? []);

      soup.sort.setAll(
        initialSortIds as Parameters<typeof soup.sort.setAll>[0]
      );

      soupView.setActiveTab(initialActiveTab);

      if (initialCrmView) {
        // Stage/owner sub-filters ride separate signals plus a client
        // predicate that must be active iff the selection is non-empty
        // (same rule as handleStageChange/handleOwnerChange in
        // unified-filter-dropdown).
        const stages = initialCrmView.stageFilter ?? [];
        soupView.setStageFilter(stages);
        if (stages.length > 0 !== soup.predicates.isActive('company-stage')) {
          soup.predicates.toggle({ and: ['company-stage'] });
        }
        const owners = initialCrmView.ownerFilter ?? [];
        soupView.setOwnerFilter(owners);
        if (owners.length > 0 !== soup.predicates.isActive('company-owner')) {
          soup.predicates.toggle({ and: ['company-owner'] });
        }
      }
    });
  });

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

  const { openSettings } = useSettingsState();
  const context: CrmWorkspace = {
    ...soupView,
    host: {
      scopeId: panel.splitHotkeyScope,
      isActive: panel.isPanelActive,
      focus: () => panel.panelRef()?.focus(),
      captureEntryState: () => panel.handle.captureEntryState(),
      openCompany: (entity, newSplit) => {
        void openEntityInSplitFromUnifiedList(entity, {
          openInNewSplit: newSplit,
          splitHandle: panel.handle,
          referredFrom: 'companies',
        });
      },
      openSettings: () => openSettings('CRM'),
      openTeamSettings: () => openSettings('Team'),
    },
  };
  return { state, context, applyDefaultCrmView };
}
