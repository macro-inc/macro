import { ListHeader } from '@app/components/view-shell/ListHeader';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EmptyStateDatabaseGraphic from '@design/empty-state-folder.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { CrmListEmpty, CrmListSkeleton } from '../components/list-state';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmRecordScope } from '../core/record';
import { ActivitySection } from './activity-section';
import { RecordItemList } from './record-item-list';

/** Lists whole databases discovered through their authorized CRM-linked rows. */
export function CrmDatabasesView(props: {
  scope?: CrmRecordScope;
  title?: JSX.Element;
}) {
  const flag = useFeatureFlag(enableDatabases);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <Show when={!props.scope && !isTouchDevice()}>
            <ListHeader title={props.title ?? 'Databases'} />
          </Show>
          <Show
            when={flag().loading}
            fallback={
              <CrmListEmpty
                graphic={EmptyStateDatabaseGraphic}
                title="Databases are unavailable"
                description="Database access is not enabled for this account."
              />
            }
          >
            <CrmListSkeleton label="Loading databases" />
          </Show>
        </div>
      }
    >
      <DatabasesList scope={props.scope} title={props.title} />
    </Show>
  );
}

function DatabasesList(props: { scope?: CrmRecordScope; title?: JSX.Element }) {
  const crm = useCrmContext();
  const source = crm.createDatabases(() => props.scope);
  const [search, setSearch] = createSignal('');
  const create = () => crm.openCreateItem('databases');
  const list = () => (
    <RecordItemList
      source={source}
      search={search()}
      onClearSearch={() => setSearch('')}
      emptyContent={
        <CrmListEmpty
          graphic={EmptyStateDatabaseGraphic}
          title="No linked databases yet"
          description={
            props.scope
              ? `Databases appear here when a row links to this ${props.scope.type}. Add a company or contact reference to a row to get started.`
              : 'Databases appear here when a row links to a CRM company or person. Add a company or contact reference to a row to get started.'
          }
          action={{ label: 'New database', onClick: create }}
        />
      }
    />
  );
  return (
    <Show
      when={props.scope}
      fallback={
        <ActivitySection
          label="Databases"
          title={props.title}
          search={search()}
          onSearchChange={setSearch}
          createLabel="New database"
          onCreate={create}
        >
          {list()}
        </ActivitySection>
      }
    >
      <RecordSection
        title="Databases"
        search={search()}
        onSearchChange={setSearch}
        createAction={{ label: 'New database', onClick: create }}
        toolbarCreate
      >
        {list()}
      </RecordSection>
    </Show>
  );
}
