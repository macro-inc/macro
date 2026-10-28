import { SearchBar, ViewShell } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import { type JSX, Show } from 'solid-js';
import { ActivityControls } from '../components/activity-controls';
import { useCrmContext } from '../context/crm-context';
import type { CrmActivityTab } from '../core/navigation';
import { RecordItemList } from './record-item-list';

/** Embedded activity uses normal view controls around an immutable CRM scope. */
export function CrmActivityView(props: {
  tab: CrmActivityTab;
  title?: JSX.Element;
}) {
  const crm = useCrmContext();
  return (
    <Show
      when={props.tab !== 'tasks' ? props.tab : undefined}
      keyed
      fallback={<crm.ActivityTasks title={props.title} />}
    >
      {(tab) => (
        <TagSetsQueryProvider>
          <ActivityList tab={tab} title={props.title} />
        </TagSetsQueryProvider>
      )}
    </Show>
  );
}

function ActivityList(props: { tab: CrmActivityTab; title?: JSX.Element }) {
  const crm = useCrmContext();
  const [state, setState] = crm.createActivityState(props.tab);
  const filters = crm.createActivityFilters(props.tab, state, setState);
  const source = crm.createActivity(
    () => props.tab,
    () => state
  );
  const controls = () => (
    <ActivityControls
      label={props.tab}
      state={state}
      filters={filters}
      setSort={(sort) => setState('sort', sort)}
      setDirection={(direction) => setState('direction', direction)}
      setGroupBy={(groupBy) => setState('groupBy', groupBy)}
    />
  );
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <Show
        when={!isTouchDevice()}
        fallback={
          <ViewShell.Header>
            <div class="flex min-w-0 items-center gap-2 px-4 py-2">
              {controls()}
              <SearchBar
                label={`Search ${props.tab}`}
                placeholder={`Search ${props.tab}`}
                value={state.search}
                onValueChange={(search) => setState('search', search)}
                class="min-w-0 flex-1"
              />
            </div>
          </ViewShell.Header>
        }
      >
        <ListHeader title={props.title ?? props.tab}>
          {controls()}
          <ListHeaderSearch
            label={`Search ${props.tab}`}
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            registerFocus={() => {}}
          />
        </ListHeader>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <RecordItemList
          source={source}
          empty={`No ${props.tab} match these CRM filters.`}
          search={state.search}
          groupByDate={state.groupBy === 'date'}
          dateField={state.sort}
          referencePropertyIds={[
            SYSTEM_PROPERTY_IDS.COMPANIES,
            SYSTEM_PROPERTY_IDS.CONTACTS,
          ]}
        />
      </div>
    </div>
  );
}
