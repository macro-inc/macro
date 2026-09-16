import type { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import type { Accessor } from 'solid-js';
import type { DriveResults } from '../context/drive-source';
import { driveQuery } from './drive-query';

export function createDriveResults(
  view: ReturnType<typeof useSoupView>,
  userId: Accessor<string | undefined>
): DriveResults {
  return {
    apply(selection, clearSearch) {
      const preset = driveQuery(selection, userId());
      view.setActiveTab(
        selection.location.kind === 'tab' && selection.location.tab !== 'recent'
          ? selection.location.tab
          : 'all'
      );
      view.queryFilters.replace(preset.filters);
      view.soup.predicates.set(preset.clientFilters);
      view.soup.grouping.setActiveGroupId(undefined);
      view.soup.sort.setAll([selection.sort]);
      view.soup.selection.clear();
      view.soup.focus.clear();
      if (clearSearch) view.setSearchText('');
    },
  };
}
