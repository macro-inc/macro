import type { AgentActivityRow } from '@macro-inc/lexical-core';
import type {
  ActivityRow,
  FoldedMessage,
} from '@service-agent-fold/generated/types';
import type { ExecutionRecord } from '@service-agent-harness/generated/schemas';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({ acquired: [] as (string | undefined)[] }));
const code = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { getCodeExecution: code.read },
}));
const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
vi.mock('./queries/live-session', () => ({
  createLiveSession: (id: () => string | undefined) => {
    live.acquired.push(id());
    return { messages };
  },
}));
vi.mock('@app/features/block-agent/ui', () => ({
  TextShimmer: (props: { text: string }) => <>{props.text}</>,
}));
vi.mock('@app/features/agent-cards/components/item-chip', () => ({
  ItemChip: (props: { fact: { item: { id: string } } }) => (
    <a href={`#${props.fact.item.id}`}>item:{props.fact.item.id}</a>
  ),
}));
vi.mock('@app/features/agent-cards/components/run-cards', () => ({
  default: (props: {
    cards: { key: string; rowId: string }[];
    sessionId?: string;
  }) => (
    <aside aria-label="Cards" data-session={props.sessionId}>
      {props.cards.map((card) => `${card.rowId}:${card.key}`).join(',')}
    </aside>
  ),
}));

import type { AgentActivityData } from '@macro-inc/lexical-core';
import { AgentActivity as Activity } from './agent-activity';

function AgentActivity(props: AgentActivityData) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <Activity {...props} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  live.acquired.length = 0;
  setMessages([]);
  code.read.mockReset();
});

const snapshot: AgentActivityRow[] = [
  { id: 't1', label: 'Running', detail: 'cargo', status: 'running' },
];

function reply(rows: ActivityRow[]): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn: 2,
    author: { kind: 'agent' },
    requestId: null,
    parts: [],
    stop: null,
    pending: false,
    segments: [
      { index: 0, kind: 'prose', start: 0, end: 1, sealed: true, rows: [] },
      { index: 1, kind: 'activity', start: 1, end: 3, sealed: false, rows },
    ],
    phase: 'working',
    postedAt: null,
  };
}

const steps = (view: ReturnType<typeof render>) =>
  view
    .getAllByRole('listitem')
    .map((item) => [item.textContent, item.dataset.status]);

it('shows a sealed run as the snapshot the message carries, without the session', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={[{ id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' }]}
      sealed
    />
  ));
  expect(steps(view)).toEqual([['Rancargo', 'completed']]);
  expect(live.acquired).toEqual([]);
});

it('ticks an open run live from the session, keeping the snapshot until it loads', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={snapshot}
      sealed={false}
    />
  ));
  expect(live.acquired).toEqual(['session']);
  expect(steps(view)).toEqual([['Runningcargo', 'running']]);

  setMessages([
    reply([
      { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
      { id: 't2', label: 'Reading', detail: 'lib.rs', status: 'running' },
    ]),
  ]);
  expect(steps(view)).toEqual([
    ['Rancargo', 'completed'],
    ['Readinglib.rs', 'running'],
  ]);
});

it('keeps a long live run on its latest steps, folding the earlier ones behind a count', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    id: `t${index}`,
    label: `Step ${index}`,
    status: 'completed' as const,
  }));
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={rows}
      sealed={false}
    />
  ));
  expect(view.getByRole('button', { name: '2 earlier steps' })).toBeTruthy();
  expect(view.queryByText('Step 1')).toBeNull();
  view.getByRole('button', { name: '2 earlier steps' }).click();
  expect(view.getByText('Step 1')).toBeTruthy();
});

it('keeps a live step and the item it names in place while the run ticks', () => {
  const created = {
    id: 't1',
    label: 'Create document',
    detail: 'Launch FAQ',
    status: 'completed' as const,
    card: {
      kind: 'item',
      itemType: 'document',
      itemId: 'doc-1',
      action: 'created',
      fileType: null,
      title: 'Launch FAQ',
      summary: null,
    } as const,
  };
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={snapshot}
      sealed={false}
    />
  ));
  setMessages([
    reply([
      { ...created },
      {
        id: 't2',
        label: 'Reading',
        detail: 'lib.rs',
        status: 'running',
        card: null,
      },
    ]),
  ]);
  const step = view.getByText('Create document').closest('li');
  const item = view.getByRole('link', { name: 'item:doc-1' });
  // A paint later the fold has sent new objects for every step.
  setMessages([
    reply([
      { ...created },
      {
        id: 't2',
        label: 'Read',
        detail: 'lib.rs',
        status: 'completed',
        card: null,
      },
      {
        id: 't3',
        label: 'Running',
        detail: 'cargo',
        status: 'running',
        card: null,
      },
    ]),
  ]);
  expect(view.getByText('Create document').closest('li')).toBe(step);
  expect(view.getByRole('link', { name: 'item:doc-1' })).toBe(item);
  expect(view.queryByRole('complementary', { name: 'Cards' })).toBeNull();
  expect(steps(view).map(([, status]) => status)).toEqual([
    'completed',
    'completed',
    'running',
  ]);
});

it('keeps what folded-away steps showed in view above the count', async () => {
  const rows = (last: 'running' | 'failed'): AgentActivityRow[] =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `t${index}`,
      label: `Step ${index}`,
      status: index === 7 ? last : 'completed',
      card: index === 0 ? { kind: 'data', sql: 'SELECT 1' } : null,
    }));
  for (const [sealed, last] of [
    [false, 'running'],
    [true, 'failed'],
  ] as const) {
    const view = render(() => (
      <AgentActivity
        agentSessionId="session"
        turn={2}
        segment={1}
        rows={rows(last)}
        sealed={sealed}
      />
    ));
    const count = view.getByRole('button', { name: '2 earlier steps' });
    expect(view.queryByText('Step 0')).toBeNull();
    const card = await view.findByRole('complementary', { name: 'Cards' });
    expect(card.textContent).toBe('t0:t0');
    expect(
      card.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    cleanup();
  }
});

it('folds a finished run into one line that opens to every step', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    id: `t${index}`,
    label: `Step ${index}`,
    status: 'completed' as const,
  }));
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={rows}
      sealed
    />
  ));
  const summary = view.getByRole('button', { name: /Worked · 8 steps/ });
  expect(view.queryByText('Step 0')).toBeNull();
  summary.click();
  expect(view.getByText('Step 0')).toBeTruthy();
  expect(view.getByText('Step 7')).toBeTruthy();
});

it('replaces a live code step with observed SDK operations and preserves uncertain outcomes', async () => {
  const executionId = '019a0000-0000-7000-8000-000000000001';
  const record: ExecutionRecord = {
    executionId,
    source: 'export async function main() {}',
    status: 'running',
    calls: [],
    activity: [
      { id: 1, label: 'Search documents', status: 'completed' },
      { id: 2, label: 'Read email', status: 'running' },
    ],
    activityTruncated: false,
  };
  code.read.mockResolvedValue(ok(record));
  const client = new QueryClient();
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Activity
        agentSessionId="session"
        turn={2}
        segment={1}
        rows={[{ id: 'code-1', label: 'Execute code', status: 'running' }]}
        sealed={false}
      />
    </QueryClientProvider>
  ));
  const message = reply([
    { id: 'code-1', label: 'Execute code', detail: null, status: 'running' },
  ]);
  message.parts = [
    { kind: 'text', text: 'Checking' },
    {
      kind: 'tool_use',
      id: 'code-1',
      name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
      status: 'running',
      detail: {
        kind: 'other',
        acpKind: 'other',
        input: { execution_id: executionId, source: record.source },
        result: null,
        output: null,
        error: null,
      },
    },
  ];
  setMessages([message]);
  await waitFor(() =>
    expect(steps(view)).toEqual([
      ['Search documents', 'completed'],
      ['Read email', 'running'],
    ])
  );
  expect(code.read).toHaveBeenCalledWith('session', executionId);

  client.setQueriesData(
    { queryKey: ['agentCodeExecution'] },
    {
      ...record,
      status: 'cancelled',
      activity: [
        { id: 1, label: 'Search documents', status: 'completed' },
        { id: 2, label: 'Read email', status: 'unknown' },
      ],
    }
  );
  await waitFor(() =>
    expect(steps(view)).toEqual([
      ['Search documents', 'completed'],
      ['Read email', 'interrupted'],
    ])
  );
  expect(view.queryByText(record.source)).toBeNull();

  code.read.mockRejectedValue(new Error('Temporary network failure'));
  await client.refetchQueries({ queryKey: ['agentCodeExecution'] });
  expect(steps(view)).toEqual([
    ['Search documents', 'completed'],
    ['Read email', 'interrupted'],
  ]);

  client.setQueriesData(
    { queryKey: ['agentCodeExecution'] },
    { ...record, source: 'another execution' }
  );
  await waitFor(() =>
    expect(steps(view)).toEqual([['Execute code', 'running']])
  );
});

it("names a live code write's item on its operation's step", async () => {
  const executionId = '019a0000-0000-7000-8000-000000000002';
  const record: ExecutionRecord = {
    executionId,
    source: 'export async function main() {}',
    status: 'running',
    calls: [],
    activity: [
      {
        id: 1,
        label: 'Create Markdown',
        status: 'completed',
        item: {
          type: 'document',
          id: 'doc-9',
          action: 'created',
          title: 'Plan',
        },
      },
      { id: 2, label: 'Patch Channel', status: 'running' },
    ],
    activityTruncated: false,
  };
  code.read.mockResolvedValue(ok(record));
  const client = new QueryClient();
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Activity
        agentSessionId="session"
        turn={2}
        segment={1}
        rows={[{ id: 'code-1', label: 'Execute code', status: 'running' }]}
        sealed={false}
      />
    </QueryClientProvider>
  ));
  const message = reply([
    { id: 'code-1', label: 'Execute code', detail: null, status: 'running' },
  ]);
  message.parts = [
    { kind: 'text', text: 'Writing' },
    {
      kind: 'tool_use',
      id: 'code-1',
      name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
      status: 'running',
      detail: {
        kind: 'other',
        acpKind: 'other',
        input: { execution_id: executionId, source: record.source },
        result: null,
        output: null,
        error: null,
      },
    },
  ];
  setMessages([message]);
  const item = await view.findByRole('link', { name: 'item:doc-9' });
  expect(item.closest('li')?.textContent).toBe('Create Markdownitem:doc-9');
  expect(view.queryByRole('complementary', { name: 'Cards' })).toBeNull();
});

it('updates a live row in place as the run paints, rather than redrawing it', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={snapshot}
      sealed={false}
    />
  ));
  setMessages([
    reply([{ id: 't1', label: 'Running', detail: 'cargo', status: 'running' }]),
  ]);
  const row = view.getByRole('listitem');

  // Every paint carries the run as new objects.
  setMessages([
    reply([{ id: 't1', label: 'Running', detail: 'cargo', status: 'running' }]),
  ]);
  expect(view.getByRole('listitem')).toBe(row);

  setMessages([
    reply([
      { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
      { id: 't2', label: 'Reading', detail: 'lib.rs', status: 'running' },
    ]),
  ]);
  expect(view.getAllByRole('listitem')[0]).toBe(row);
  expect(steps(view)).toEqual([
    ['Rancargo', 'completed'],
    ['Readinglib.rs', 'running'],
  ]);
});

it('keeps snapshots free of tool details while authorized live rows retain them', () => {
  const safe = [{ id: 't1', label: 'Ran', status: 'completed' as const }];
  const snapshotView = render(() => (
    <AgentActivity
      agentSessionId="private-session"
      turn={2}
      segment={1}
      rows={safe}
      sealed
    />
  ));
  expect(snapshotView.getByRole('listitem').textContent).toBe('Ran');
  expect(live.acquired).toEqual([]);
  snapshotView.unmount();
  const liveView = render(() => (
    <AgentActivity
      agentSessionId="private-session"
      turn={2}
      segment={1}
      rows={safe}
      sealed={false}
    />
  ));
  expect(liveView.getByRole('listitem').textContent).toBe('Ran');
  setMessages([
    reply([{ ...safe[0], detail: 'TOKEN=private-value run-report' }]),
  ]);
  expect(liveView.getByRole('listitem').textContent).toBe(
    'RanTOKEN=private-value run-report'
  );
});

it('keeps a finished run open when a step failed', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={[
        { id: 't1', label: 'Searched', status: 'completed' },
        { id: 't2', label: 'Posted', status: 'failed' },
      ]}
      sealed
    />
  ));
  expect(view.queryByRole('button', { name: /Worked/ })).toBeNull();
  expect(steps(view)).toEqual([
    ['Searched', 'completed'],
    ['Posted', 'failed'],
  ]);
});

it('names the item a step made on its line, and shows a composed view in place of its step', async () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={[
        {
          id: 't1',
          label: 'Create document',
          detail: 'Launch FAQ',
          status: 'completed',
          card: {
            kind: 'item',
            itemType: 'document',
            itemId: 'doc-1',
            action: 'created',
          },
        },
        {
          id: 't2',
          label: 'Display results',
          status: 'completed',
          card: { kind: 'view', view: { widgets: [] } },
        },
      ]}
      sealed
    />
  ));
  const cards = await view.findAllByRole('complementary', { name: 'Cards' });
  expect(cards.map((card) => card.textContent)).toEqual(['t2:t2']);
  // The item stands in for the step's detail: it opens what the step made.
  expect(view.getByText('Create document').closest('li')?.textContent).toBe(
    'Create documentitem:doc-1'
  );
  expect(view.queryByText('Display results')).toBeNull();
  expect(live.acquired).toEqual([]);
});

it('shows drafts saved for review in place of the step that presented them', async () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={[
        {
          id: 'call_1',
          label: 'Prepared drafts to review',
          status: 'completed',
        },
        {
          id: 'review_r-1',
          label: 'Prepared drafts to review',
          status: 'completed',
          card: { kind: 'review', reviewId: 'r-1', drafts: 'email' },
        },
      ]}
      sealed
    />
  ));
  const cards = await view.findAllByRole('complementary', { name: 'Cards' });
  expect(cards.map((card) => card.textContent)).toEqual([
    'review_r-1:review:r-1',
  ]);
  expect(cards[0].dataset.session).toBe('session');
  // The agent's own call stays a step; the presentation is its card.
  expect(view.getAllByText('Prepared drafts to review')).toHaveLength(1);
});

it('loads no cards for a run that showed nothing', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={snapshot}
      sealed
    />
  ));
  expect(view.queryByRole('complementary', { name: 'Cards' })).toBeNull();
});
