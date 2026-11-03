import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { DocumentEntity } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { type CrmContext, CrmProvider } from '../context/crm-context';
import type { ItemListSource } from '../context/crm-sources';
import type { FileTypesSource } from '../context/file-types';
import { DEFAULT_FILE_TYPES, type FileTypeCatalog } from '../core/file-types';
import { RecordFiles } from '../views/record-files';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

// Real record/files/dialog components with in-memory storage; no account writes.
function Fixture() {
  const [record, setRecord] = createSignal('company-a');
  const [overview, setOverview] = createSignal(true);
  const [catalog, setCatalog] = createSignal<FileTypeCatalog | null>(null);
  const [documents, setDocuments] = createSignal<DocumentEntity[]>([
    {
      id: 'shared',
      type: 'document',
      name: 'Shared contract',
      fileType: 'pdf',
      ownerId: '',
    },
    {
      id: 'view-only',
      type: 'document',
      name: 'Read-only proposal',
      fileType: 'pdf',
      ownerId: '',
    },
  ]);
  const [links, setLinks] = createSignal(
    new Map([
      ['company-a', ['shared', 'view-only']],
      ['company-b', ['shared']],
    ])
  );
  const [values, setValues] = createSignal(
    new Map<string, string | null>([
      ['shared', null],
      ['view-only', null],
    ])
  );
  const [created, setCreated] = createSignal(0);
  const [opened, setOpened] = createSignal('');
  const [failLink, setFailLink] = createSignal(false);
  const [session, setSession] = createSignal('viewer:team');
  const [pages, setPages] = createSignal(0);
  const [loadedPages, setLoadedPages] = createSignal(0);
  const [failPage, setFailPage] = createSignal(false);
  const [pageError, setPageError] = createSignal(false);
  const [readState, setReadState] = createSignal<
    'ready' | 'catalog-loading' | 'values-loading' | 'no-team' | 'catalog-error'
  >('ready');
  const source: FileTypesSource = {
    sessionKey: session,
    data: () =>
      readState() === 'ready' || readState() === 'values-loading'
        ? catalog()
        : undefined,
    pending: () =>
      readState() === 'catalog-loading' || readState() === 'no-team',
    error: () => readState() === 'catalog-error',
    refresh: async () => {},
    canManage: () => readState() !== 'no-team',
    initialize: async () => {
      setCatalog({
        definitionId: 'file-type',
        options: DEFAULT_FILE_TYPES.map((name) => ({ id: name, name })),
      });
    },
    add: async (name) => {
      setCatalog(
        (current) =>
          current && {
            ...current,
            options: [...current.options, { id: name, name }],
          }
      );
    },
    rename: async (id, name) => {
      setCatalog(
        (current) =>
          current && {
            ...current,
            options: current.options.map((option) =>
              option.id === id ? { ...option, name } : option
            ),
          }
      );
    },
    remove: async (id) => {
      setCatalog(
        (current) =>
          current && {
            ...current,
            options: current.options.filter((option) => option.id !== id),
          }
      );
      setValues(
        (current) =>
          new Map(
            [...current].map(([key, value]) => [
              key,
              value === id ? null : value,
            ])
          )
      );
    },
    classify: async (id, type) => {
      setValues((current) => new Map(current).set(id, type));
    },
    classifications: () => ({
      data: () => (readState() === 'ready' ? values() : undefined),
      pending: () => readState() !== 'ready',
      error: () => false,
      refresh: async () => {},
    }),
    canEdit: (id) => () => id() !== 'view-only',
    candidates: (query) => ({
      files: () =>
        documents().filter((file) =>
          file.name.toLowerCase().includes(query().toLowerCase())
        ),
      pending: () => false,
      hasMore: () => false,
      error: () => undefined,
      loadMore: async () => {},
    }),
    create: async (name) => {
      setCreated((count) => count + 1);
      const id = `created-${created()}`;
      setDocuments((current) => [
        ...current,
        { id, type: 'document', name, fileType: 'md', ownerId: '' },
      ]);
      setValues((current) => new Map(current).set(id, null));
      return id;
    },
    attach: async (id, target) => {
      if (failLink()) {
        setFailLink(false);
        throw new Error('offline');
      }
      setLinks((current) =>
        new Map(current).set(target.id, [
          ...new Set([...(current.get(target.id) ?? []), id]),
        ])
      );
    },
  };
  const items: ItemListSource = {
    get data() {
      return {
        entities: documents().filter((file) =>
          links().get(record())?.includes(file.id)
        ),
      };
    },
    isPending: false,
    isEnabled: true,
    isLoading: false,
    isError: false,
    get hasNextPage() {
      return pages() > 0;
    },
    isFetchingNextPage: false,
    get isFetchNextPageError() {
      return pageError();
    },
    fetchNextPage: async () => {
      if (failPage()) {
        setFailPage(false);
        setPageError(true);
        return;
      }
      setPageError(false);
      if (pages() === 0) return;
      setPages((count) => count - 1);
      setLoadedPages((count) => count + 1);
      const id = `page-${loadedPages()}`;
      setDocuments((current) => [
        ...current,
        {
          id,
          type: 'document',
          name: `Paged contract ${loadedPages()}`,
          fileType: 'pdf',
          ownerId: '',
        },
      ]);
      setValues((current) => new Map(current).set(id, 'Contract'));
      setLinks((current) =>
        new Map(current).set(record(), [...(current.get(record()) ?? []), id])
      );
    },
    refetch: async () => {},
  };
  const context: Pick<
    CrmContext,
    'createFileTypes' | 'createRecordFiles' | 'createNavigation'
  > = {
    createFileTypes: () => source,
    createRecordFiles: () => items,
    createNavigation: () => ({
      splitId: undefined,
      openEntity: (entity) => {
        setOpened(entity.id);
      },
      openWithSplit: (entity) => {
        setOpened(entity.id);
      },
      showCompanies: () => {},
    }),
  };
  return (
    <CrmProvider value={context as CrmContext}>
      <main class="h-dvh overflow-auto bg-panel p-4 text-ink">
        <div class="mb-6 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              setRecord(record() === 'company-a' ? 'company-b' : 'company-a')
            }
          >
            Switch record
          </Button>
          <Button onClick={() => setOverview(!overview())}>
            Switch surface
          </Button>
          <Button onClick={() => setFailLink(true)}>
            Fail next attachment
          </Button>
          <span aria-label="Created files">{created()}</span>
          <Button
            onClick={() =>
              setValues((current) =>
                new Map(current).set('shared', 'missing-type')
              )
            }
          >
            Simulate unavailable type
          </Button>
          <span aria-label="Opened file">{opened()}</span>
          <Button onClick={() => setSession((value) => `${value}:next`)}>
            Switch session
          </Button>
          <Button
            onClick={() =>
              setDocuments((current) => current.map((file) => ({ ...file })))
            }
          >
            Refresh files
          </Button>
          <Button onClick={() => setPages(3)}>Enable more files</Button>
          <Button onClick={() => setFailPage(true)}>Fail next page</Button>
          <span aria-label="Loaded pages">{loadedPages()}</span>
          <For
            each={
              [
                'ready',
                'catalog-loading',
                'values-loading',
                'no-team',
                'catalog-error',
              ] as const
            }
          >
            {(state) => (
              <Button onClick={() => setReadState(state)}>
                Simulate {state}
              </Button>
            )}
          </For>
        </div>
        <h1 class="mb-5 text-xl font-semibold">
          {record() === 'company-a' ? 'Northstar' : 'Acme'} ·{' '}
          {overview() ? 'Overview' : 'Files'}
        </h1>
        <RecordFiles
          scope={{ type: 'company', id: record(), domains: [] }}
          overview={overview()}
        />
      </main>
    </CrmProvider>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <UserContextProvider>
          <AnalyticsContextProvider>
            <PosthogProvider>
              <EmailLinksContextProvider>
                <ItemDndProvider>
                  <Fixture />
                </ItemDndProvider>
              </EmailLinksContextProvider>
            </PosthogProvider>
          </AnalyticsContextProvider>
        </UserContextProvider>
      </QueryClientProvider>
    ),
    root
  );
