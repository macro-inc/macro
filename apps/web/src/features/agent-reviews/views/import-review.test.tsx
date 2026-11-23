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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { Review, ReviewDecision } from '../core/review';
import { ImportReview } from './import-review';

type ImportReviewRecord = Review & { kind: 'import' };

const imports = vi.hoisted(() => {
  const state: {
    entities: ImportEntity[];
    report: NotionImportReport | undefined;
    cancel: Mock;
    open: Mock;
  } = { entities: [], report: undefined, cancel: vi.fn(), open: vi.fn() };
  return state;
});
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: imports.open }),
}));
vi.mock('@core/mobile/isMobile', () => ({
  isMobile: () => window.innerWidth < 640,
}));
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
  useWorkspaceImportReportQuery: () => ({
    get isPending() {
      return imports.report === undefined;
    },
    get data() {
      return imports.report;
    },
  }),
  useCancelWorkspaceImportMutation: () => ({ mutateAsync: imports.cancel }),
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
    dependencyOf?: string[];
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

function completedReport() {
  return {
    status: 'completed' as const,
    reviewId: 'review',
    pages: 3,
    dataSources: 1,
    copy: 1,
    tasks: 1,
    skip: 1,
    hand: 0,
    documents: 1,
    databases: 1,
    databaseRows: 3,
    taskRows: 0,
    imported: 2,
    waiting: 0,
    writing: 0,
    confirmed: {
      documents: 1,
      databases: 1,
      databaseRows: 9,
      taskLists: 0,
      tasks: 0,
    },
    details: {
      notImported: [
        {
          kind: 'left_out' as const,
          item: {
            importId: 'scratch',
            title: 'Scratch',
            kind: 'page' as const,
            reason: 'Empty template',
          },
        },
      ],
      viewChanges: [
        {
          databaseId: 'roadmap',
          title: 'Roadmap',
          views: [
            {
              viewId: 'board',
              title: 'Task Board',
              changes: [
                {
                  kind: 'filter' as const,
                  count: 1,
                  message: 'The filter may include rows with an empty status.',
                },
                {
                  kind: 'visibility' as const,
                  count: 1,
                  message: 'Shown here, hidden in Notion: Meeting.',
                },
              ],
            },
          ],
        },
      ],
      tabChoices: [
        {
          containerId: 'inline',
          containerTitle: 'Project Home',
          database: 'Roadmap',
          tab: 'Task Board',
        },
      ],
      notes: [],
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1024);
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
    item?: Partial<ImportReviewRecord['items'][0]>;
    canAct?: boolean;
    review?: Partial<Omit<ImportReviewRecord, 'kind' | 'items'>>;
  } = {}
) {
  let record: ImportReviewRecord = {
    id: 'review',
    sessionId: 'session',
    actingUser: 'macro|owner@macro.local',
    executionId: null,
    kind: 'import',
    title: 'Import from Notion',
    revision: 0,
    updatedAt: 0,
    presentedAt: 1,
    decision: null,
    items: [
      {
        id: 'plan',
        status: 'pending',
        error: null,
        draft: { source: 'notion' },
        result: null,
        ...options.item,
      },
    ],
    ...options.review,
  };
  const decide = vi.fn(async (decision: ReviewDecision): Promise<Review> => {
    if (decision.revision !== record.revision) throw new Error('conflict');
    const [item] = record.items;
    record = {
      ...record,
      revision: record.revision + 1,
      items: [
        decision.action === 'edit'
          ? decision.draft.kind === 'import'
            ? { ...item, draft: decision.draft.draft }
            : item
          : {
              ...item,
              status: decision.action === 'submit' ? 'submitting' : 'dismissed',
            },
      ],
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
  it.each([390, 1024])(
    'keeps the linked-page label and controls at %i pixels',
    (width) => {
      vi.stubGlobal('innerWidth', width);
      const title = 'Engineering Handbook and quarterly planning';
      imports.entities = [
        entity('handbook', null, title, { decision: 'copy' }),
        entity('tasks', null, 'Tasks', {
          decision: 'copy',
          rows: 4,
          dependencyOf: ['notion-handbook'],
        }),
      ];
      setup();
      const row = screen.getByText('Tasks').closest('li')!;
      const label = within(row).getByText(`Linked from ${title}`);
      const controls = within(row).getByRole('checkbox').closest('li')!
        .firstElementChild!;
      expect(controls.contains(label)).toBe(true);
      expect(label.classList.contains('mobile:basis-full')).toBe(true);
      expect(label.classList.contains('mobile:whitespace-normal')).toBe(true);
      expect(label.classList.contains('mobile:order-last')).toBe(true);
      expect(within(row).getByText('Link')).toBeTruthy();
      expect(within(row).getByText('Only you')).toBeTruthy();
    }
  );

  it('shows one confirmed outcome and keeps each kind of import detail reachable', () => {
    vi.stubGlobal('innerWidth', 390);
    imports.report = completedReport();
    setup({ item: { status: 'completed' } });

    expect(
      screen.getByText(
        'Imported 1 page and 1 database (9 rows). 1 page left out.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/importing 1 page/i)).toBeNull();
    expect(screen.queryByText('40 rows')).toBeNull();
    expect(screen.queryByText('Needs attention')).toBeNull();
    const expand = (label: string) => {
      const summary = screen.getByText(label);
      const disclosure = summary.closest('details')!;
      expect(disclosure.open).toBe(false);
      fireEvent.click(summary);
      expect(disclosure.open).toBe(true);
      return within(disclosure);
    };
    expect(
      expand('Not imported · 1 page').getByText(/Empty template/)
    ).toBeTruthy();
    const views = expand('View changes · 1 view');
    const filter = views.getByText(/may include rows/);
    const visibility = views.getByText(/Shown here, hidden in Notion: Meeting/);
    expect(
      filter.compareDocumentPosition(visibility) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      expand('Tab choices · 1 placement').getByText(
        /Notion didn’t say which tab was showing\. We used Task Board/
      )
    ).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Import plan' })).toBeTruthy();
  });

  it.each([390, 1024])(
    'shows failures and the run error at %i pixels',
    (width) => {
      vi.stubGlobal('innerWidth', width);
      imports.report = {
        ...completedReport(),
        error: 'Notion stopped responding',
        failures: [
          {
            importId: 'first',
            title: 'Handbook',
            kind: 'page',
            reason: 'Not enough access',
          },
          {
            importId: 'second',
            title: 'Milestones',
            kind: 'data_source',
            reason: 'Source was deleted',
          },
        ],
      };
      setup({ item: { status: 'completed' } });

      expect(screen.getByRole('status').textContent).toContain(
        '2\u00a0items couldn’t be imported.'
      );
      const summary = screen.getByText('Needs attention · 2 items');
      expect(summary.classList.contains('text-failure')).toBe(true);
      const disclosure = summary.closest('details')!;
      expect(disclosure.open).toBe(true);
      const details = within(disclosure);
      const error = details.getByText('Notion stopped responding');
      const list = details.getByRole('list');
      expect(
        error.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(within(list).getByText('Handbook')).toBeTruthy();
      expect(within(list).getByText('Milestones')).toBeTruthy();
    }
  );

  it('uses complete totals even when the report lists only samples', () => {
    const report = completedReport();
    imports.report = {
      ...report,
      failureCount: 55,
      failures: [
        {
          importId: 'first',
          title: 'Handbook',
          kind: 'page',
          reason: 'Not enough access',
        },
      ],
      confirmed: {
        ...report.confirmed,
        databaseRows: 11,
        partialDatabaseRows: 2,
      },
      details: {
        ...report.details,
        omissionCounts: [
          { kind: 'left_out', pages: 60, databases: 0, other: 0 },
        ],
      },
    };
    setup({ item: { status: 'completed' } });

    expect(screen.getByRole('status').textContent).toContain(
      'Imported 1 page and 1 database (9 rows). 60 pages left out. 55\u00a0items couldn’t be imported.'
    );
    expect(screen.getByText('Not imported · 60 pages')).toBeTruthy();
    const disclosure = screen
      .getByText('Needs attention · 55 items')
      .closest('details')!;
    expect(
      within(disclosure).getByText(
        '2 rows were copied into databases that did not finish importing.'
      )
    ).toBeTruthy();
    expect(within(disclosure).getByText('Showing 1 of 55 items.')).toBeTruthy();
  });

  it('shows surviving rows on a stopped import without treating cancellation as a run failure', () => {
    const report = completedReport();
    imports.report = {
      ...report,
      status: 'dismissed',
      error: 'Cancelled',
      confirmed: {
        ...report.confirmed,
        databaseRows: 11,
        partialDatabaseRows: 2,
      },
    };
    setup({ item: { status: 'completed' } });

    expect(screen.getByRole('status').textContent).toContain('Import stopped');
    const disclosure = screen
      .getByText('Needs attention', { exact: true })
      .closest('details')!;
    expect(
      within(disclosure).getByText(
        '2 rows were copied into databases that did not finish importing.'
      )
    ).toBeTruthy();
    expect(within(disclosure).queryByText('Cancelled')).toBeNull();
  });

  it('uses the singular failure sentence when no items were written', () => {
    const report = completedReport();
    imports.report = {
      ...report,
      imported: 0,
      failureCount: 1,
      confirmed: {
        documents: 0,
        databases: 0,
        databaseRows: 0,
        taskLists: 0,
        tasks: 0,
      },
      details: { notImported: [], viewChanges: [], tabChoices: [], notes: [] },
      failures: [
        {
          importId: 'guide',
          title: 'Guide',
          kind: 'page',
          reason: 'No access',
        },
      ],
    };
    setup({ item: { status: 'completed' } });
    expect(screen.getByRole('status').textContent).toBe(
      'Nothing was imported. 1\u00a0item couldn’t be imported.'
    );
  });

  it('shows an actionable run error without a failed object', () => {
    imports.report = {
      ...completedReport(),
      error: 'Notion stopped responding',
      details: { notImported: [], viewChanges: [], tabChoices: [], notes: [] },
    };
    setup({ item: { status: 'completed' } });
    const disclosure = screen
      .getByText('Needs attention', { exact: true })
      .closest('details')!;
    expect(disclosure.open).toBe(true);
    expect(
      within(disclosure).getByText('Notion stopped responding')
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain(
      'couldn’t be imported'
    );
  });

  it('omits the empty report landmark when everything succeeded', () => {
    imports.report = {
      ...completedReport(),
      details: { notImported: [], viewChanges: [], tabChoices: [], notes: [] },
    };
    setup({ item: { status: 'completed' } });
    expect(screen.queryByRole('region', { name: 'Import report' })).toBeNull();
  });

  it('groups choices and view changes and labels tab placements', () => {
    const report = completedReport();
    const item = report.details.notImported[0].item;
    const board = report.details.viewChanges[0].views[0];
    imports.report = {
      ...report,
      details: {
        ...report.details,
        notImported: [
          ...report.details.notImported,
          {
            kind: 'left_out',
            item: {
              ...item,
              importId: 'example',
              title: 'Example page',
              reason: 'Example content',
            },
          },
          {
            kind: 'by_hand',
            item: {
              ...item,
              importId: 'billing',
              title: 'Billing page',
              reason: 'Manual review',
            },
          },
        ],
        viewChanges: [
          {
            ...report.details.viewChanges[0],
            views: [board, { ...board, viewId: 'table', title: 'All records' }],
          },
          {
            databaseId: 'archive',
            title: 'Archive',
            views: [{ ...board, viewId: 'archived' }],
          },
        ],
        tabChoices: [
          ...report.details.tabChoices,
          { ...report.details.tabChoices[0], containerTitle: 'Team Home' },
        ],
        notes: [
          {
            kind: 'omitted',
            count: 3,
            message: 'Three assignments could not be mapped.',
          },
          { kind: 'other', count: 8, message: 'An older warning.' },
        ],
      },
    };
    setup({ item: { status: 'completed' } });

    expect(screen.getByRole('status').textContent).toContain(
      '3 pages left out.'
    );
    const imported = screen
      .getByText('Not imported · 3 pages')
      .closest('details')!;
    const choices = within(imported);
    expect(
      choices.getByText('Left out by the reviewed plan · 2 pages')
    ).toBeTruthy();
    expect(choices.getByText('Left for the agent · 1 page')).toBeTruthy();
    expect(choices.getByText('Empty template')).toBeTruthy();
    expect(screen.getByText('Couldn’t be copied · 3 items')).toBeTruthy();
    expect(screen.getByText('Other details · 1 notice')).toBeTruthy();
    const views = within(
      screen.getByText('View changes · 3 views').closest('details')!
    );
    expect(views.getAllByText(/ › /).map((label) => label.textContent)).toEqual(
      ['Roadmap › Task Board', 'Roadmap › All records', 'Archive › Task Board']
    );
    expect(screen.getByText('Project Home › Roadmap')).toBeTruthy();
    expect(screen.getByText('Team Home › Roadmap')).toBeTruthy();
  });

  it.each([390, 1024])(
    'keeps notices available before the tree at %i pixels',
    async (width) => {
      vi.stubGlobal('innerWidth', width);
      imports.report = {
        status: 'completed',
        reviewId: 'review',
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
        waiting: 0,
        writing: 0,
        warnings: Array.from(
          { length: 22 },
          (_, index) => `Notice ${index + 1}`
        ),
      };
      setup({ item: { status: 'completed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Open full review' }));
      const dialog = await screen.findByRole('dialog');
      const tree = within(dialog).getByRole('list', { name: 'Import plan' });
      const toggle = within(dialog).getByText('22 notices');
      const disclosure = toggle.closest('details')!;
      expect(disclosure.open).toBe(width !== 390);
      expect(
        within(dialog)
          .getByRole('list', { name: 'Import warnings', hidden: true })
          .closest('details')
      ).toBe(disclosure);
      expect(
        disclosure.compareDocumentPosition(tree) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      fireEvent.click(toggle);
      expect(disclosure.open).toBe(width === 390);
      if (!disclosure.open) fireEvent.click(toggle);
      const warnings = within(dialog).getByRole('list', {
        name: 'Import warnings',
      });
      expect(within(warnings).getAllByRole('listitem')).toHaveLength(22);
      expect(within(tree).getByText('Wiki')).toBeTruthy();
    }
  );

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
          kind: 'import',
          draft: {
            source: 'notion',
            excluded: ['roadmap'],
            shared: [],
            personal: [],
          },
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
      review: {
        decision: { by: 'owner', via: 'chat', revision: 0, items: [] },
      },
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
      screen.getByText('Import stopped — 2 imported items stay')
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
          kind: 'import',
          draft: {
            source: 'notion',
            excluded: [],
            shared: [],
            personal: ['wiki', 'guide'],
          },
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
          kind: 'import',
          draft: {
            source: 'notion',
            excluded: [],
            shared: [],
            personal: ['wiki'],
          },
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
        draft: {
          kind: 'import',
          draft: { source: 'notion', excluded: [], shared: [], personal: [] },
        },
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
