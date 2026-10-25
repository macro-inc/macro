/** @vitest-environment jsdom */
import type { ImportEntity, NotionImportReport } from '@queries/import';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewDecision, ReviewItem } from '../core/review';
import { ImportReview } from './import-review';

const imports = vi.hoisted(() => ({
  entities: [] as ImportEntity[],
  report: undefined as NotionImportReport | undefined,
  cancel: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: imports.open }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
// The real icon table loads every block, which opens app connections.
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <span data-icon={props.targetType} />
  ),
}));
vi.mock('@queries/import', () => ({
  useImportQuery: () => ({
    isPending: false,
    isPlaceholderData: false,
    data: { runs: [], entities: imports.entities },
  }),
  useNotionImportReportQuery: () => ({
    get isPending() {
      return imports.report === undefined;
    },
    get data() {
      return imports.report;
    },
  }),
  useCancelNotionImportMutation: () => ({ mutateAsync: imports.cancel }),
}));

function entity(
  id: string,
  parentId: string | null,
  title: string,
  plan: {
    decision?: string;
    reason?: string;
    rows?: number;
    sampleTitles?: string[];
    taskFields?: { status?: string; due?: string };
    shared?: boolean;
    sharedReason?: string;
    shareable?: boolean;
    alreadyImported?: { by: string; entityId: string; entityType: string };
  },
  overrides: Partial<ImportEntity> = {}
): ImportEntity {
  return {
    id,
    user_id: 'owner',
    source: 'notion',
    kind: plan.rows === undefined ? 'page' : 'data_source',
    foreign_id: `notion-${id}`,
    parent_id: parentId,
    review_id: 'review',
    status: 'staged',
    initiator: 'chat',
    metadata: {
      title,
      url: `https://notion.so/${id}`,
      plan: { path: [], ...plan },
    },
    created_at: '2026-10-19T00:00:00Z',
    updated_at: '2026-10-19T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  imports.entities = [
    entity('wiki', null, 'Wiki', { decision: 'copy' }),
    entity('roadmap', 'wiki', 'Roadmap', {
      decision: 'tasks',
      reason: 'Rows have a status and an owner',
      rows: 40,
    }),
    entity('scratch', 'wiki', 'Scratch', {
      decision: 'skip',
      reason: 'Empty',
    }),
    entity('billing', null, 'Billing', {
      decision: 'hand',
      reason: 'Holds credentials',
    }),
    entity(
      'other',
      null,
      'Other review',
      { decision: 'copy' },
      {
        review_id: 'older-review',
      }
    ),
  ];
  imports.report = undefined;
  imports.cancel.mockReset();
  imports.open.mockReset();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(
  options: {
    item?: Partial<ReviewItem>;
    canAct?: boolean;
    review?: Partial<Review>;
  } = {}
) {
  let record: Review = {
    id: 'review',
    sessionId: 'session',
    kind: 'import',
    title: 'Import from Notion',
    revision: 0,
    updatedAt: 0,
    presentedAt: 1,
    items: [
      {
        id: 'plan',
        status: 'pending',
        draft: { source: 'notion' },
        ...options.item,
      },
    ],
    ...options.review,
  };
  const decide = vi.fn(async (decision: ReviewDecision) => {
    if (decision.revision !== record.revision) throw new Error('conflict');
    record = {
      ...record,
      revision: record.revision + 1,
      items: record.items.map((item) =>
        decision.action === 'edit'
          ? { ...item, draft: decision.draft }
          : {
              ...item,
              status: decision.action === 'submit' ? 'submitting' : 'dismissed',
            }
      ),
    };
    return record;
  });
  render(() => (
    <ImportReview
      review={record}
      canAct={options.canAct ?? true}
      actions={{ decide, reload: async () => record }}
    />
  ));
  return decide;
}

describe('import review', () => {
  it('saves what the owner leaves out and imports the rest', async () => {
    const decide = setup();
    expect(
      screen.getByText(
        'Notion shared 3 pages and 1 database — importing 1 page, 40 tasks · 1 skipped, 1 needs you'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Other review')).toBeNull();
    expect(screen.getByText('Holds credentials')).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Import Scratch' })
        .disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Import Roadmap' }));
    expect(screen.getByRole('button', { name: 'Import 1 page' })).toBeTruthy();
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        action: 'edit',
        revision: 0,
        item: 'plan',
        draft: {
          source: 'notion',
          excluded: ['roadmap'],
          shared: [],
          personal: [],
        },
      })
    );

    // The card's button approves; there is no confirmation step.
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 page' }));
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith({
        action: 'submit',
        revision: 1,
        items: [],
      })
    );
    expect(await screen.findByText('Starting the import…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('dismisses the plan without importing', async () => {
    const decide = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        action: 'dismiss',
        revision: 0,
        items: [],
      })
    );
  });

  it('hides the choices from viewers who cannot act', () => {
    setup({ canAct: false });
    expect(screen.getByText('Roadmap')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Import \d/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('shows progress and failures once approved, and stops the run', async () => {
    imports.report = {
      status: 'importing',
      pages: 3,
      dataSources: 1,
      copy: 1,
      tasks: 1,
      skip: 1,
      hand: 1,
      documents: 1,
      databases: 1,
      databaseRows: 0,
      taskRows: 0,
      imported: 1,
      waiting: 2,
      writing: 1,
      reviewId: 'review',
      handItems: [],
      failures: [
        {
          importId: 'roadmap',
          title: 'Roadmap',
          kind: 'data_source',
          reason: 'Notion rate limited the request',
        },
      ],
    };
    imports.cancel.mockResolvedValue({
      ...imports.report,
      status: 'dismissed',
    });
    setup({ item: { status: 'completed' } });

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '1'
    );
    expect(screen.getByText(/1 of 4 imported/)).toBeTruthy();
    expect(screen.getByText(/1 writing/)).toBeTruthy();
    expect(screen.getByText(/Notion rate limited the request/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(imports.cancel).toHaveBeenCalledTimes(1));
  });

  it("says when the agent started the import at the owner's request", () => {
    setup({
      item: { status: 'submitting' },
      review: { decision: { via: 'chat' } },
    });
    expect(
      screen.getByText('Started by the agent at your request')
    ).toBeTruthy();
    cleanup();

    setup({ item: { status: 'submitting' } });
    expect(screen.queryByText(/Started by the agent/)).toBeNull();
  });

  it('says what stays after the run was stopped', () => {
    imports.report = {
      status: 'dismissed',
      error: 'Cancelled',
      pages: 3,
      dataSources: 1,
      copy: 1,
      tasks: 1,
      skip: 1,
      hand: 1,
      documents: 1,
      databases: 1,
      databaseRows: 0,
      taskRows: 0,
      imported: 2,
      waiting: 1,
      writing: 0,
      reviewId: 'review',
      handItems: [],
      failures: [],
    };
    setup({ item: { status: 'completed' } });
    expect(
      screen.getByText('Import stopped — 2 imported objects stay')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('saves who each object is shared with, down the tree', async () => {
    imports.entities = [
      entity('wiki', null, 'Wiki', {
        decision: 'copy',
        shared: true,
        shareable: true,
        sharedReason: 'Team handbook',
      }),
      entity('guide', 'wiki', 'Guide', {
        decision: 'copy',
        shared: true,
        shareable: true,
      }),
      entity('roadmap', 'wiki', 'Roadmap', {
        decision: 'tasks',
        rows: 40,
        shared: false,
        shareable: false,
        sharedReason: 'Personal notes',
      }),
      entity('billing', null, 'Billing', {
        decision: 'hand',
        reason: 'Holds credentials',
      }),
    ];
    const decide = setup();
    expect(
      screen.getByText('2 shared with your team · 1 only you')
    ).toBeTruthy();
    const plan = screen.getByRole('list', { name: 'Import plan' });
    expect(within(plan).getByText('Only you')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Roadmap with your team/ })
    ).toBeNull();

    const wiki = screen.getByRole('button', {
      name: 'Make Wiki only visible to you',
    });
    expect(wiki.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(wiki);
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith({
        action: 'edit',
        revision: 0,
        item: 'plan',
        draft: {
          source: 'notion',
          excluded: [],
          shared: [],
          personal: ['wiki', 'guide'],
        },
      })
    );
    expect(screen.getByText('3 only you')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Share Guide with your team' })
        .getAttribute('aria-pressed')
    ).toBe('false');

    fireEvent.click(
      screen.getByRole('button', { name: 'Share Guide with your team' })
    );
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith({
        action: 'edit',
        revision: 1,
        item: 'plan',
        draft: {
          source: 'notion',
          excluded: [],
          shared: [],
          personal: ['wiki'],
        },
      })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Share Wiki with your team' })
    );
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith({
        action: 'edit',
        revision: 2,
        item: 'plan',
        draft: { source: 'notion', excluded: [], shared: [], personal: [] },
      })
    );

    expect(
      screen.getByText('2 shared with your team · 1 only you')
    ).toBeTruthy();
  });

  it('lists what teammates already imported instead of importing it again', async () => {
    imports.entities = [
      entity('wiki', null, 'Wiki', {
        decision: 'copy',
        shared: true,
        shareable: true,
        alreadyImported: {
          by: 'ana@acme.com',
          entityId: 'doc-wiki',
          entityType: 'md',
        },
      }),
      entity('notes', 'wiki', 'Notes', { decision: 'copy' }),
      entity('crm', null, 'CRM', {
        decision: 'copy',
        rows: 12,
        alreadyImported: {
          by: 'bo@acme.com',
          entityId: 'db-crm',
          entityType: 'database',
        },
      }),
      entity('old', null, 'Old', {
        decision: 'copy',
        alreadyImported: {
          by: 'ana@acme.com',
          entityId: 'legacy',
          entityType: 'no-such-type',
        },
      }),
    ];
    setup();
    const plan = screen.getByRole('list', { name: 'Import plan' });
    expect(within(plan).getByText('Notes')).toBeTruthy();
    expect(within(plan).queryByText('Wiki')).toBeNull();
    expect(screen.getByRole('button', { name: 'Import 1 page' })).toBeTruthy();

    const disclosure = screen.getByRole('button', {
      name: '3 already in Macro (imported by ana@acme.com, bo@acme.com)',
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Wiki' })).toBeNull();

    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    const section = screen.getByRole('region', { name: 'Already in Macro' });
    expect(within(section).getAllByText('by ana@acme.com')).toHaveLength(2);
    expect(within(section).getByText('Old')).toBeTruthy();
    expect(within(section).queryByRole('link', { name: 'Old' })).toBeNull();
    expect(
      within(section).getByRole('link', { name: 'CRM' }).getAttribute('href')
    ).toMatch(/\/app\/database\/db-crm$/);
    const link = within(section).getByRole('link', { name: 'Wiki' });
    expect(link.getAttribute('href')).toMatch(/\/app\/md\/doc-wiki$/);
    fireEvent.click(link);
    expect(imports.open).toHaveBeenCalledWith(
      { type: 'md', id: 'doc-wiki' },
      expect.anything()
    );
  });

  it('fills in while it is planned and opens for approval once ready', () => {
    imports.entities = [];
    const planning: NotionImportReport = {
      status: 'running',
      reviewId: 'review',
      onTeam: true,
      scanned: { pages: 40, dataSources: 12 },
      pages: 0,
      dataSources: 0,
      copy: 0,
      tasks: 0,
      skip: 0,
      hand: 0,
      documents: 0,
      databases: 0,
      databaseRows: 0,
      taskRows: 0,
      imported: 0,
      waiting: 0,
      writing: 0,
    };
    imports.report = planning;
    setup();
    expect(
      screen.getByText('Reading Notion: 40 pages, 12 databases')
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Import' }).disabled
    ).toBe(true);
    cleanup();

    // Staged, and one of two decided.
    imports.entities = [
      entity('wiki', null, 'Wiki', { decision: 'copy' }),
      entity('roadmap', 'wiki', 'Roadmap', { rows: 40 }),
    ];
    imports.report = { ...planning, pages: 1, dataSources: 1 };
    setup();
    expect(
      screen.getByText('Deciding what to import: 1 of 2 decided')
    ).toBeTruthy();
    expect(screen.getByText('Deciding…')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Import' }).disabled
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Import Wiki' })
        .disabled
    ).toBe(true);
    cleanup();

    imports.entities = [
      entity('wiki', null, 'Wiki', { decision: 'copy' }),
      entity('roadmap', 'wiki', 'Roadmap', { decision: 'skip', rows: 40 }),
    ];
    imports.report = { ...planning, pages: 1, dataSources: 1, status: 'ready' };
    setup();
    expect(screen.queryByText(/Deciding/)).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Import 1 page' })
        .disabled
    ).toBe(false);
  });

  it("says nothing is shared when the owner isn't on a team", () => {
    imports.report = {
      status: 'ready',
      reviewId: 'review',
      onTeam: false,
      pages: 3,
      dataSources: 1,
      copy: 1,
      tasks: 1,
      skip: 1,
      hand: 1,
      documents: 1,
      databases: 0,
      databaseRows: 0,
      taskRows: 40,
      imported: 0,
      waiting: 2,
      writing: 0,
    };
    setup();
    expect(
      screen.getByText(
        "2 only you — you're not on a team, so nothing is shared"
      )
    ).toBeTruthy();
  });

  it("shows a database's sample rows and task columns, and the whole plan", async () => {
    imports.entities = [
      entity('roadmap', null, 'Roadmap', {
        decision: 'tasks',
        rows: 2365,
        sampleTitles: ['Fix login redirect', 'Q3 pricing page'],
        taskFields: { status: 'Stage', due: 'Deadline' },
      }),
      entity('crm', null, 'CRM', {
        decision: 'copy',
        rows: 12,
        sharedReason: 'Personal notes',
      }),
    ];
    setup();
    expect(screen.getByText('Task lists')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show rows of Roadmap' })
    );
    expect(
      screen.getByText('2,365 tasks — Fix login redirect, Q3 pricing page, …')
    ).toBeTruthy();
    expect(
      screen.getByText('Status from “Stage” · Due from “Deadline”')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open full review' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('list', { name: 'Import plan' })
    ).toBeTruthy();
    expect(within(dialog).getByText('CRM')).toBeTruthy();
  });
});
