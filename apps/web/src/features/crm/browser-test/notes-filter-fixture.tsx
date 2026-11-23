import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import { createCrmActivityFilters } from '../activity-filters-adapter';
import { ActivityControls } from '../components/activity-controls';
import type { CrmActivityViewState } from '../core/activity-view';

/** Feature-owned browser fixture keeps private filter/view imports within CRM. */
export function CrmNotesFilterFixture(props: {
  initialIds: string[];
  requests: Accessor<number>;
}) {
  const [state, setState] = createStore<CrmActivityViewState>({
    search: '',
    facets: { tags: ['retained-tag'], 'created-by': props.initialIds },
    sort: 'updated_at',
    direction: 'desc',
    groupBy: 'date',
  });
  const filters = createCrmActivityFilters('notes', state, setState);
  return (
    <main class="p-6 bg-page text-ink min-h-screen">
      <ActivityControls
        label="Notes"
        state={state}
        filters={filters}
        setSort={(value) => setState('sort', value)}
        setDirection={(value) => setState('direction', value)}
        setGroupBy={(value) => setState('groupBy', value)}
      />
      <pre data-testid="selected-ids">
        {JSON.stringify(state.facets['created-by'] ?? [])}
      </pre>
      <pre data-testid="facets">{JSON.stringify(state.facets)}</pre>
      <span data-testid="requests">{props.requests()}</span>
    </main>
  );
}
