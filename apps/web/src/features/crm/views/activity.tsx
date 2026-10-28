import EmptyStateCallsGraphic from '@design/empty-state-calls.svg';
import EmptyStateDocGraphic from '@design/empty-state-doc.svg';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import EmptyStateTasksGraphic from '@design/empty-state-tasks.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { CrmListEmpty } from '../components/list-state';
import { useCrmContext } from '../context/crm-context';
import type { CrmActivityTab, CrmSoupActivityTab } from '../core/navigation';
import { ActivitySection } from './activity-section';
import { CrmDatabasesView } from './databases';
import { RecordItemList } from './record-item-list';

const CONTENT = {
  tasks: {
    title: 'Tasks',
    graphic: EmptyStateTasksGraphic,
    action: 'New task',
    description:
      'Create a task and choose a company or person to keep your follow-ups here.',
  },
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

/** Workspace activity shares the paged rows and states of record sections. */
export function CrmActivityView(props: {
  tab: CrmActivityTab;
  title?: JSX.Element;
}) {
  const tab = () => (props.tab === 'databases' ? undefined : props.tab);
  return (
    <Show
      when={tab()}
      keyed
      fallback={<CrmDatabasesView title={props.title} />}
    >
      {(current) => <ActivityList tab={current} title={props.title} />}
    </Show>
  );
}

function ActivityList(props: { tab: CrmSoupActivityTab; title?: JSX.Element }) {
  const crm = useCrmContext();
  const source = crm.createActivity(() => props.tab);
  const [search, setSearch] = createSignal('');
  const content = () => CONTENT[props.tab];
  const create = () => {
    if (props.tab === 'tasks') return crm.openTaskComposer();
    if (props.tab === 'email') return crm.openEmailComposer();
    return crm.openCreateItem(props.tab);
  };
  return (
    <ActivitySection
      label={content().title}
      title={props.title}
      search={search()}
      onSearchChange={setSearch}
      createLabel={content().action}
      onCreate={create}
    >
      <RecordItemList
        source={source}
        search={search()}
        onClearSearch={() => setSearch('')}
        emptyContent={
          <CrmListEmpty
            graphic={content().graphic}
            title={`No ${props.tab} linked yet`}
            description={content().description}
            action={{ label: content().action, onClick: create }}
          />
        }
      />
    </ActivitySection>
  );
}
