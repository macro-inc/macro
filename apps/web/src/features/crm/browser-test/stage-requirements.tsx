import '@app/index.css';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { DatabaseTimelineView } from '../../database/views/database-timeline-view';
import { StageRequirementsDialog } from '../components/stage-requirements-dialog';
import { type CrmContext, CrmProvider } from '../context/crm-context';
import type { StageRequirement } from '../core/stage-requirements';
import { AddPipelineRecordDialog } from '../views/add-pipeline-record';

const unused = (): never => {
  throw new Error('Unused fixture capability');
};
const context: CrmContext = {
  createPipelines: unused,
  createDatabases: unused,
  openCreateItem: unused,
  openEmailComposer: unused,
  PipelineEditor: unused,
  PipelineEntries: unused,
  PipelineSharing: unused,
  createPipelineTransfer: unused,
  downloadCsv: unused,
  createContactPhoto: unused,
  contactInitials: unused,
  userEmail: unused,
  copyViewLink: unused,
  copyPipelineLink: unused,
  copyRecordLink: unused,
  createNavigation: unused,
  listsEnabled: unused,
  pipelinesEnabled: unused,
  createCompanyEmails: unused,
  createContactEmails: unused,
  createActivity: unused,
  createActivityState: unused,
  createActivityFilters: unused,
  ActivityTasks: unused,
  openTaskComposer: unused,
  registerTaskComposerRecord: unused,
  createRecordFiles: unused,
  createRecordCalls: unused,
  createRecordReferences: unused,
  RecordTasks: unused,
  createPropertyCommands: unused,
  hydrateCompany: unused,
  createSettingsCommands: unused,
  createReplaceStages: unused,
  createResetStages: unused,
  createExportDefinitions: unused,
  exportCompanies: unused,
  createDisplayOptions: unused,
  openCreateCompany: unused,
  openCreateContact: unused,
  userId: unused,
  isTeamAdmin: unused,
  createCompanySource: unused,
  createContactSource: unused,
  createTeamSource: unused,
  createTeamConfigSource: unused,
  createCapabilities: unused,
  createDealStages: unused,
  createPersonalViews: unused,
  createTeamViews: unused,
  createLists: unused,
  createCompanyImporter: unused,
  createBlockedDomains: unused,
  renameCompany: unused,
  renameContact: unused,
  createContactPhones: unused,
  setContactPhones: unused,
  hideCompany: unused,
  hideContact: unused,
  setEmailSync: unused,
  feedback: { success: unused, failure: unused },
  createCompany: () => ({
    isPending: false,
    mutate: unused,
    mutateAsync: async () => ({ id: 'new-company' }),
  }),
  createContact: () => ({
    isPending: false,
    mutate: unused,
    mutateAsync: async () => ({ id: 'new-contact' }),
  }),
  createCompanySuggestions: () => ({
    companies: () => [
      { id: 'acme', name: 'Acme', domains: [{ domain: 'acme.com' }] },
    ],
    query: { isLoading: false },
  }),
  createContactSuggestions: () => ({
    contacts: () => [],
    query: { isLoading: false },
  }),
};
const columns: DatabaseViewColumn[] = [
  {
    id: 'company',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    primary: true,
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    writable: true,
    options: [
      { id: 'lead', label: 'Lead', color: null },
      { id: 'negotiation', label: 'Negotiation', color: null },
    ],
  },
  {
    id: 'amount',
    name: 'Amount',
    dataType: 'NUMBER',
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'schedule',
    name: 'Schedule',
    dataType: 'DATE_RANGE',
    isMultiSelect: false,
    writable: true,
    options: [],
  },
];
function Fixture() {
  const [rules, setRules] = createSignal<StageRequirement[]>([]);
  const [configuring, setConfiguring] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [fail, setFail] = createSignal(false);
  const [saved, setSaved] = createSignal('');
  const [timeline, setTimeline] = createSignal(false);
  const [initialValues, setInitialValues] = createSignal<
    Record<string, DatabaseCellValue>
  >({ stage: 'Negotiation' });
  return (
    <CrmProvider value={context}>
      <main class="min-h-screen bg-canvas-base p-4 text-ink">
        <h1 class="mb-4 text-xl">Sales pipeline</h1>
        <div class="flex flex-wrap gap-2">
          <Button onClick={() => setConfiguring(true)}>
            Stage requirements
          </Button>
          <Button
            onClick={() => {
              setInitialValues({ stage: 'Negotiation' });
              setAdding(true);
            }}
          >
            Add deal
          </Button>
          <Button
            onClick={() => {
              setRules([
                {
                  columnId: 'stage',
                  optionId: 'negotiation',
                  fields: ['amount'],
                },
              ]);
              setTimeline(true);
            }}
          >
            Open timeline
          </Button>
          <Button onClick={() => setFail(true)}>Reject next save</Button>
        </div>
        <output aria-label="Saved deal">{saved()}</output>
        <Show when={timeline()}>
          <div class="mt-4 flex h-[500px] min-w-0 flex-col">
            <DatabaseTimelineView
              view={{
                query: { filter: null, sort: [] },
                layout: {
                  kind: 'timeline',
                  range: 'schedule',
                  title: 'company',
                  groupBy: 'stage',
                  colorBy: null,
                },
              }}
              rows={[
                {
                  rowId: 'existing',
                  cells: {
                    stage: 'Negotiation',
                    schedule:
                      '2026-10-26T00:00:00.000Z/2026-10-28T00:00:00.000Z',
                  },
                },
              ]}
              columns={columns}
              canEdit
              filtered={false}
              rowPending={() => false}
              onOpen={unused}
              onWrite={unused}
              onCreate={unused}
              onCompose={(values) => {
                setInitialValues(values);
                setAdding(true);
              }}
            />
          </div>
        </Show>
        <Show when={configuring()}>
          <StageRequirementsDialog
            columns={columns}
            rules={rules()}
            onClose={() => setConfiguring(false)}
            onSave={async (rule) => {
              if (fail()) {
                setFail(false);
                throw new Error('Failed');
              }
              setRules([rule]);
            }}
          />
        </Show>
        <Show when={adding()}>
          <AddPipelineRecordDialog
            pipeline={{ name: 'Sales', recordType: 'company' }}
            columns={columns}
            requirements={rules()}
            initialValues={initialValues()}
            onClose={() => setAdding(false)}
            onCreate={async (creation) => {
              if (fail()) {
                setFail(false);
                return false;
              }
              setSaved(JSON.stringify(creation.values));
              return true;
            }}
          />
        </Show>
      </main>
    </CrmProvider>
  );
}
const root = document.getElementById('root');
if (root) render(Fixture, root);
