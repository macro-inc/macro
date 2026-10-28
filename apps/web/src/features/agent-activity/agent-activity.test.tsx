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

it('folds a long run behind a count of its earlier steps', () => {
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
  expect(view.getByRole('button', { name: '2 earlier steps' })).toBeTruthy();
  expect(view.queryByText('Step 1')).toBeNull();
  view.getByRole('button', { name: '2 earlier steps' }).click();
  expect(view.getByText('Step 1')).toBeTruthy();
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
