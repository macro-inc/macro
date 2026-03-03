import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/filters';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID } from '@app/constants/list-views';
import { useUserContext } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { batch, createMemo } from 'solid-js';

/**
 * Hook that provides detection of active filter refinements beyond tab defaults,
 * and a function to reset filters to the current tab's default state.
 */
export function useFilterRefinements() {
  const {
    soup,
    queryFilters,
    setQueryFilters,
    statusFilter,
    setStatusFilter,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const currentView = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component' || !isListViewID(content.id)) return;

    return content.id;
  });

  const currentPreset = createMemo(() => {
    const view = currentView();
    if (!view) return undefined;

    const viewConfig = VIEW_TAB_PRESETS[view];
    if (!viewConfig) return undefined;

    const tab = activeTab() ?? viewConfig.default;
    const resolver = viewConfig.tabs[tab];
    if (!resolver) return undefined;

    return resolver(getPresetContext());
  });

  const hasActiveRefinements = createMemo(() => {
    const preset = currentPreset();
    if (!preset) return false;

    const expectedIds = new Set([
      ...(preset.clientFilters.and ?? []),
      ...(preset.clientFilters.or ?? []),
    ]);

    const currentIds = new Set(soup.filters.activeIds() as FilterID[]);

    const hasClientFilterDiff =
      expectedIds.size !== currentIds.size ||
      [...expectedIds].some((id) => !currentIds.has(id as FilterID));

    const hasQueryFilterDiff = !deepEqual(queryFilters(), preset.queryFilters);

    const hasSubFilters =
      statusFilter().length > 0 || assigneeFilter().length > 0;

    return hasClientFilterDiff || hasQueryFilterDiff || hasSubFilters;
  });

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.filters.set(preset.clientFilters);
      setQueryFilters(preset.queryFilters);
      setStatusFilter([]);
      setAssigneeFilter([]);
    });
  };

  return {
    hasActiveRefinements,
    resetToTabDefaults,
    currentView,
  };
}
