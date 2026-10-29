import EmptyStateCallsGraphic from '@design/empty-state-calls.svg';
import EmptyStateDocGraphic from '@design/empty-state-doc.svg';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import { type JSX, Show } from 'solid-js';
import { ActivityControls } from '../components/activity-controls';
import { CrmListEmpty } from '../components/list-state';
import { useCrmContext } from '../context/crm-context';
import type { CrmActivityTab, CrmSoupActivityTab } from '../core/navigation';
import { ActivitySection } from './activity-section';
import { CrmDatabasesView } from './databases';
import { RecordItemList } from './record-item-list';

const CONTENT = {
  email: {
    title: 'Email',
    graphic: EmptyStateEmailGraphic,
    action: 'New email',
    description:
      'Email your CRM companies and people to see those conversations here.',
  },
  notes: {
    title: 'Notes',
    graphic: EmptyStateDocGraphic,
    action: 'New note',
    description:
      'Create a note and link a company or person through its Companies or Contacts property.',
  },
  calls: {
    title: 'Calls',
    graphic: EmptyStateCallsGraphic,
    action: 'New call',
    description:
      'Start a call with your CRM contacts, or link a company or person to an existing call.',
  },
};

/** Workspace activity combines normal view controls with the fixed CRM scope. */
export function CrmActivityView(props: {
  tab: CrmActivityTab;
  title?: JSX.Element;
}) {
  const crm = useCrmContext();
  const tab = () => (props.tab === 'databases' ? undefined : props.tab);
  return (
    <Show
      when={tab()}
      keyed
      fallback={<CrmDatabasesView title={props.title} />}
    >
      {(current) => (
        <Show
          when={current !== 'tasks' ? current : undefined}
          keyed
          fallback={<crm.ActivityTasks title={props.title} />}
        >
          {(activity) => (
            <TagSetsQueryProvider>
              <ActivityList tab={activity} title={props.title} />
            </TagSetsQueryProvider>
          )}
        </Show>
      )}
    </Show>
  );
}

function ActivityList(props: {
  tab: Exclude<CrmSoupActivityTab, 'tasks'>;
  title?: JSX.Element;
}) {
  const crm = useCrmContext();
  const [state, setState] = crm.createActivityState(props.tab);
  const filters = crm.createActivityFilters(props.tab, state, setState);
  const source = crm.createActivity(
    () => props.tab,
    () => state
  );
  const content = () => CONTENT[props.tab];
  const create = () => {
    if (props.tab === 'email') return crm.openEmailComposer();
    return crm.openCreateItem(props.tab);
  };
  return (
    <ActivitySection
      label={content().title}
      title={props.title}
      search={state.search}
      onSearchChange={(search) => setState('search', search)}
      createLabel={content().action}
      onCreate={create}
      controls={
        <ActivityControls
          label={props.tab}
          state={state}
          filters={filters}
          setSort={(sort) => setState('sort', sort)}
          setDirection={(direction) => setState('direction', direction)}
          setGroupBy={(groupBy) => setState('groupBy', groupBy)}
        />
      }
    >
      <RecordItemList
        source={source}
        search={state.search}
        onClearSearch={() => setState('search', '')}
        groupByDate={state.groupBy === 'date'}
        dateField={state.sort}
        referencePropertyIds={[
          SYSTEM_PROPERTY_IDS.COMPANIES,
          SYSTEM_PROPERTY_IDS.CONTACTS,
        ]}
        emptyContent={
          <Show
            when={filters.activeCount() === 0}
            fallback={
              <CrmListEmpty
                title={`No ${props.tab} match these filters`}
                description="Clear your filters to see all CRM-linked items."
                action={{ label: 'Clear filters', onClick: filters.clear }}
              />
            }
          >
            <CrmListEmpty
              graphic={content().graphic}
              title={`No ${props.tab} linked yet`}
              description={content().description}
              action={{ label: content().action, onClick: create }}
            />
          </Show>
        }
      />
    </ActivitySection>
  );
}
