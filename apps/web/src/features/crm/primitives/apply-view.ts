import { batch } from 'solid-js';
import type { CrmViewCommands } from '../context/view-commands';
import type { CrmViewConfig } from '../core/saved-view';
/** Apply an entire snapshot atomically, preserving explicit ungrouped layouts. */
export function createApplyCrmView(commands: CrmViewCommands) {
  return (config: CrmViewConfig) =>
    batch(() => {
      if (config.activeTab !== undefined)
        commands.setActiveTab(config.activeTab);
      commands.replaceFilters(config.filters);
      commands.replacePredicates(config.clientFilters ?? {});
      commands.setSearchText(config.searchText ?? '');
      commands.setGroupBy(config.groupBy ?? undefined);
      commands.setSort(config.sort?.length ? config.sort : ['updated_at']);
      commands.setStageFilter(config.stageFilter ?? []);
      commands.setOwnerFilter(config.ownerFilter ?? []);
    });
}
