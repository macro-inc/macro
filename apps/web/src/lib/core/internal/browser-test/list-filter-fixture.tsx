import { ListFilterDropdown } from '@app/components/view-shell/ListDropdowns';
import { CrmNotesFilterFixture } from '@app/features/crm/browser-test/notes-filter-fixture';
import { useDriveFilters } from '@app/features/drive-view/filters/use-drive-filters';
import { DriveFilterDrawer } from '@app/features/drive-view/views/drive-filter-drawer';
import { Show } from 'solid-js';
import { driveValue, requests, SELECTED } from './list-filter-adapters';

export function DriveListFilterFixture() {
  const filters = useDriveFilters();
  return (
    <main class="p-6 bg-page text-ink min-h-screen">
      <Show
        when={matchMedia('(pointer: coarse)').matches}
        fallback={
          <ListFilterDropdown
            label="Filter files"
            groups={filters.groups()}
            isSelected={filters.isSelected}
            selectedIds={filters.selectedIds}
            onSelectionChange={filters.setSelected}
            onClear={filters.clear}
          />
        }
      >
        <DriveFilterDrawer />
      </Show>
      <pre data-testid="selected-ids">
        {JSON.stringify(driveValue().facets['created-by'] ?? [])}
      </pre>
      <pre data-testid="facets">{JSON.stringify(driveValue().facets)}</pre>
      <span data-testid="requests">{requests()}</span>
    </main>
  );
}

export function NotesListFilterFixture() {
  return (
    <CrmNotesFilterFixture
      initialIds={[SELECTED, 'unavailable-person']}
      requests={requests}
    />
  );
}
