import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import EmptyStateDatabaseGraphic from '@design/empty-state-folder.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { CrmListEmpty, CrmListSkeleton } from '../components/list-state';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmRecordScope } from '../core/record';
import { RecordItemList } from './record-item-list';

/** Lists whole databases discovered through their authorized CRM-linked rows. */
export function CrmDatabasesView(props: { scope?: CrmRecordScope }) {
  const flag = useFeatureFlag(enableDatabases);
  return (
    <Show
      when={flag().enabled}
      fallback={
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
      }
    >
      <DatabasesList scope={props.scope} />
    </Show>
  );
}

function DatabasesList(props: { scope?: CrmRecordScope }) {
  const crm = useCrmContext();
  const source = crm.createDatabases(() => props.scope);
  const [search, setSearch] = createSignal('');
  const create = () => crm.openCreateItem('databases');
  return (
    <RecordSection
      title="Databases"
      search={search()}
      onSearchChange={setSearch}
      actions={
        <Button variant="outline" onClick={create}>
          <PlusIcon class="size-4" />
          New database
        </Button>
      }
    >
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
    </RecordSection>
  );
}
