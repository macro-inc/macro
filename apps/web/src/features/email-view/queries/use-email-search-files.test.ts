import { createTagFacetContext } from '@app/features/soup/filters';
import type { EmailEntity } from '@entity/types/entity';
import {
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEmailQuery, type EmailQueryContext } from './email-query';
import {
  EMAIL_SEARCH_FILE_THREAD_LIMIT,
  useEmailSearchFiles,
} from './use-email-search-files';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/types/search')),
}));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const thread = (id: string): EmailEntity => ({
  type: 'email',
  id,
  name: id,
  ownerId: 'viewer',
  isRead: true,
  isDraft: false,
  isImportant: true,
  done: false,
});

const withFiles = (id: string, ...filenames: string[]): EmailEntity => ({
  ...thread(id),
  senderName: 'Sender',
  attachments: filenames.map((filename) => ({
    id: `${id}:${filename}`,
    filename,
  })),
});

const context: EmailQueryContext = {
  tab: 'important',
  inboxIds: undefined,
  facets: {},
  facetContext: createTagFacetContext([]),
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});

function mount(initialThreads: EmailEntity[], initialQuery = 'report') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [threads, setThreads] = createSignal(initialThreads);
    const [query, setQuery] = createSignal(initialQuery);
    const [details, setDetails] = createSignal<EmailEntity[]>();
    const lookup = {
      get isPending() {
        return details() === undefined;
      },
      isPlaceholderData: false,
      get data() {
        const entities = details();
        if (!entities) throw new Error('Read pending file lookup');
        return { entities, groups: undefined };
      },
    } as SoupAstItemsQuery;
    vi.mocked(useSoupAstItemsQuery).mockReturnValue(lookup);
    const files = useEmailSearchFiles({
      threads,
      query,
      context: () => context,
    });
    const [args, options] = vi.mocked(useSoupAstItemsQuery).mock.calls[0];
    return { files, args, options, setThreads, setQuery, setDetails };
  });
}

const filenames = (
  rows: ReturnType<ReturnType<typeof mount>['files']['rows']>
) =>
  rows.flatMap((row) => (row.kind === 'email-file' ? [row.file.filename] : []));

describe('useEmailSearchFiles', () => {
  it('stays idle and empty without matched threads', () => {
    const root = mount([]);

    expect(root.options?.().enabled).toBe(false);
    expect(root.files.rows()).toEqual([]);
  });

  it('looks up the top matched threads by ID in the All view of the current mailbox scope', () => {
    const threads = Array.from({ length: 30 }, (_, index) =>
      thread(`t${index}`)
    );
    const root = mount(threads);
    const topIds = threads
      .slice(0, EMAIL_SEARCH_FILE_THREAD_LIMIT)
      .map((entity) => entity.id);

    expect(root.options?.()).toEqual({
      enabled: true,
      keepPreviousData: false,
    });
    expect(root.args()).toEqual(
      buildEmailQuery({ ...context, tab: 'all' }, topIds)
    );
  });

  it('lists no files until the lookup resolves, then the files of matched threads', () => {
    const root = mount([thread('a'), thread('b')]);

    expect(root.files.rows()).toEqual([]);
    root.setDetails([
      withFiles('b', 'notes.txt', 'Report.pdf'),
      withFiles('a'),
    ]);

    expect(filenames(root.files.rows())).toEqual(['Report.pdf', 'notes.txt']);
  });

  it('expands the section for the current search text only', () => {
    const root = mount([thread('a')]);
    root.setDetails([withFiles('a', '1.pdf', '2.pdf', '3.pdf', '4.pdf')]);

    expect(filenames(root.files.rows())).toHaveLength(3);
    root.files.toggleExpanded();
    expect(filenames(root.files.rows())).toHaveLength(4);
    root.setQuery('report 2');
    expect(filenames(root.files.rows())).toHaveLength(3);
  });
});
