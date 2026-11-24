import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { CrmCompanyEntity } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  DatabaseLinkValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../../block-database/database-mentions';
import { GridCell } from '../../database/components/grid-cell';
import { applyTheme } from '../../theme/utils/themeUtils';
import { PipelineEntryCards } from '../components/pipeline-entry-cards';
import { RecordOverview } from '../components/record-overview';
import { type CrmContext, CrmProvider } from '../context/crm-context';
import type {
  AddToPipelineSource,
  PipelineRowAdded,
} from '../context/pipelines';
import { stageColumn } from '../core/add-to-pipeline';
import type { CrmContact } from '../core/contact';
import type { Pipeline } from '../core/pipeline';
import type { PipelineEntry } from '../core/pipeline-entry';
import {
  FIXTURE_REQUIREMENTS,
  fixtureColumns,
  fixtureEntry,
  fixturePipeline,
} from '../tests/add-to-pipeline-fixture';
import { CompanyHeader } from '../views/company-header';
import { ContactHeader } from '../views/contact-header';

// The real company and contact headers and Pipelines card over a local
// source: the team's pipelines, the record's rows, and row writes are signals,
// with made-up companies, people and pipelines.
const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'Macro Dark' : 'Macro Light');
document.documentElement.dataset.touchDevice = String(isTouchDevice());
const kind = params.get('kind') === 'contact' ? 'contact' : 'company';
const empty = params.get('empty') === 'true';

const COMPANY: CrmCompanyEntity = {
  type: 'crm_company',
  id: 'company-northwind',
  name: 'Northwind Ceramics',
  ownerId: 'user-fixture',
  teamId: 'team-fixture',
  hidden: false,
  domains: [
    {
      id: 'domain-northwind',
      companyId: 'company-northwind',
      domain: 'northwind.example',
    },
  ],
};
const CONTACT: CrmContact = {
  id: 'contact-imani',
  name: 'Imani Oduya',
  email: 'imani@northwind.example',
  companyId: null,
  hidden: false,
  firstInteraction: '2026-09-02T15:00:00Z',
  lastInteraction: '2026-11-10T15:00:00Z',
  createdAt: '2026-09-02T15:00:00Z',
  updatedAt: '2026-11-10T15:00:00Z',
};

const newBusiness = fixturePipeline('new-business', 'New business', 'company');
const COMPANY_PIPELINES: Pipeline[] = [
  newBusiness,
  fixturePipeline('renewals', 'Renewals', 'company'),
  fixturePipeline('referrals', 'Partner referrals', 'company', {
    grant: 'view',
  }),
  fixturePipeline('hiring', 'Hiring', 'contact'),
  fixturePipeline('ideas', 'Ideas', null),
];
const hiring = fixturePipeline('hiring', 'Hiring', 'contact');
const CONTACT_PIPELINES: Pipeline[] = [
  hiring,
  fixturePipeline('advisory', 'Customer advisory board', 'contact'),
  fixturePipeline('events', 'Event invites', 'contact', { grant: 'comment' }),
  newBusiness,
];

const unused = (): never => {
  throw new Error('Unused fixture capability');
};
const mutation = {
  isPending: false,
  mutate: () => {},
  mutateAsync: async () => ({ id: 'unused' }),
};

function Fixture() {
  const [pipelines] = createSignal<Pipeline[]>(
    empty ? [] : kind === 'company' ? COMPANY_PIPELINES : CONTACT_PIPELINES
  );
  const [entries, setEntries] = createSignal<PipelineEntry[]>(
    empty
      ? []
      : kind === 'company'
        ? [fixtureEntry(newBusiness, 'row-1', 'Qualified', 12000)]
        : [fixtureEntry(hiring, 'row-1', 'Lead')]
  );
  const [reads, setReads] = createSignal<string[]>([]);
  const [writes, setWrites] = createSignal(0);
  let nextOutcome: PipelineRowAdded['kind'] = 'added';
  const read = (name: string) => setReads((current) => [...current, name]);
  Object.assign(window, {
    failNextAdd() {
      nextOutcome = 'failed';
    },
  });
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const createSource = (): AddToPipelineSource => {
    read('pipelines');
    read('entries');
    const [loading, setLoading] = createSignal(true);
    setTimeout(() => setLoading(false), 400);
    return {
      pipelines,
      loading,
      error: () => false,
      retry: async () => {},
      entries,
      createSchema(pipeline) {
        read(`schema:${pipeline.id}`);
        const [ready, setReady] = createSignal(false);
        setTimeout(() => setReady(true), 300);
        return {
          columns: () => (ready() ? fixtureColumns(kind) : undefined),
          requirements: () => (ready() ? FIXTURE_REQUIREMENTS : undefined),
          loading: () => !ready(),
          error: () => false,
        };
      },
      async addRow(pipeline, columns, creation) {
        setWrites((count) => count + 1);
        await wait(300);
        const outcome = nextOutcome;
        nextOutcome = 'added';
        if (outcome === 'failed')
          return { kind: 'failed', message: 'The pipeline refused this row.' };
        const values = creation.values ?? {};
        const stage = stageColumn(columns);
        const amount = values.amount;
        setEntries((current) => [
          ...current,
          fixtureEntry(
            pipeline,
            `row-${current.length + 1}`,
            String((stage && values[stage.id]) ?? ''),
            typeof amount === 'number' ? amount : null
          ),
        ]);
        return { kind: 'added' };
      },
      cells: {
        renderTextEditor: (editor) => <DatabaseTextEditor {...editor} />,
        renderTextValue: (value) => <DatabaseTextValue value={value} />,
        renderLinkValue: (url) => <DatabaseLinkValue url={url} />,
      },
    };
  };

  const base: Partial<CrmContext> = {
    createAddToPipeline: createSource,
    feedback: {
      success: (message) => toast.success(message),
      failure: (message) => toast.failure(message),
    },
    createCompanySource: () => ({
      query: {
        data: COMPANY,
        isPending: false,
        isSuccess: true,
        isLoading: false,
        isError: false,
        refetch: async () => COMPANY,
      },
      company: () => COMPANY,
    }),
    createContactSource: () => ({
      data: CONTACT,
      isPending: false,
      isSuccess: true,
      isLoading: false,
      isError: false,
      refetch: async () => CONTACT,
    }),
    isTeamAdmin: () => () => true,
    userId: () => 'user-fixture',
    renameCompany: () => mutation,
    renameContact: () => mutation,
    hideCompany: () => mutation,
    hideContact: () => mutation,
    editContactEmail: () => mutation as never,
    editContactCompany: () => mutation as never,
    editCompanyDomain: () => mutation,
    createCompany: () => mutation,
    createContact: () => mutation,
    contactInitials: (name) => (name ?? 'IO').slice(0, 2).toUpperCase(),
    createNavigation: () => ({
      splitId: undefined,
      openWithSplit: () => {},
      showCompanies: () => {},
      openEntity: () => {},
    }),
    createCompanySuggestions: () => {
      read('companies');
      return {
        companies: () => [
          {
            id: COMPANY.id,
            name: COMPANY.name,
            domains: [{ domain: 'northwind.example' }],
          },
        ],
        query: { isLoading: false },
      };
    },
    createContactSuggestions: () => ({
      contacts: () => [],
      query: { isLoading: false },
    }),
  };
  const context = new Proxy(base, {
    get: (target, key) =>
      key in target ? target[key as keyof CrmContext] : unused,
  }) as CrmContext;

  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CrmProvider value={context}>
        <main class="flex h-dvh flex-col overflow-auto bg-panel text-ink">
          <RecordOverview>
            <Show
              when={kind === 'company'}
              fallback={<ContactHeader contact={CONTACT} />}
            >
              <CompanyHeader company={COMPANY} />
            </Show>
            <StaticMarkdownContext>
              <PipelineEntryCards
                entries={entries()}
                onOpenPipeline={() => {}}
                renderCell={(entry, cell, display) => (
                  <GridCell
                    column={cell().column}
                    value={cell().value}
                    wrap={display.fit !== 'line'}
                    emptyLabel={display.emptyLabel}
                    canEdit={false}
                    layout="property"
                    renderTextValue={(value) => (
                      <DatabaseTextValue value={value} fit={display.fit} />
                    )}
                    onWrite={async () => entry() !== undefined}
                    onAddOption={async () => false}
                  />
                )}
              />
            </StaticMarkdownContext>
            <output aria-label="Reads" class="sr-only">
              {reads().join(',')}
            </output>
            <output aria-label="Pipeline writes" class="sr-only">
              {writes()}
            </output>
          </RecordOverview>
        </main>
        <ToastRegion />
      </CrmProvider>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
