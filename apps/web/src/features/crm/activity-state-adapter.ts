import { makePersistedState } from '@app/lib/persistence';
import { createEntryPersistenceStorage } from '@components/app/split-layout/entry-persistence';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createStore } from 'solid-js/store';
import { z } from 'zod';
import { normalizeFacetSelection } from '../soup';
import type { CrmActivityViewState } from './core/activity-view';
import type { CrmSoupActivityTab } from './core/navigation';

const stateSchema = z.object({
  search: z.string(),
  facets: z.record(z.string(), z.array(z.string())),
  sort: z.enum(['updated_at', 'created_at', 'viewed_at']),
  direction: z.enum(['desc', 'asc']),
  groupBy: z.enum(['none', 'date']),
});

/** Per-entry, per-activity controls never modify the ordinary app views. */
export function createCrmActivityState(tab: CrmSoupActivityTab) {
  const panel = useSplitPanelOrThrow();
  const key = `crm.activity.${tab}`;
  const [state, setState] = withSplitPanelOwner(key, () =>
    makePersistedState(
      createStore<CrmActivityViewState>({
        search: '',
        facets: {},
        sort: 'updated_at',
        direction: 'desc',
        groupBy: tab === 'email' || tab === 'tasks' ? 'date' : 'none',
      }),
      {
        storages: [
          createEntryPersistenceStorage<
            CrmActivityViewState,
            CrmActivityViewState
          >({
            handle: panel.handle,
            key,
            restore: (_current, stored) => {
              const result = stateSchema.safeParse(stored);
              return result.success ? result.data : undefined;
            },
            select: (state) => ({
              ...state,
              facets: normalizeFacetSelection(state.facets),
            }),
          }),
        ],
      }
    )
  );
  return [state, setState] as const;
}
