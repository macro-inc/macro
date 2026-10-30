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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
  WorkingDots: () => null,
  DisclosureCaret: () => null,
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

// jsdom has no ResizeObserver; the summary's disclosure measures with one.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

/** The step an open run's line names, and where it got to. */
const line = (view: ReturnType<typeof render>) => {
  const step = view
    .getByRole('status')
    .querySelector<HTMLElement>('[data-status]');
  return [step?.textContent, step?.dataset.status];
};

it('folds a sealed run to a summary that opens to its steps, without the session', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={[
        { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
        { id: 't2', label: 'Read', detail: 'lib.rs', status: 'failed' },
      ]}
      sealed
    />
  ));
  expect(live.acquired).toEqual([]);
  expect(view.queryAllByRole('listitem')).toEqual([]);
  view.getByRole('button', { name: 'Used 2 tools · 1 failed' }).click();
  expect(steps(view)).toEqual([
    ['Ran', 'completed'],
    ['ReadFailed', 'failed'],
  ]);
});

it('shows an open run as one line naming the step it is on, live from the session', () => {
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
  expect(line(view)).toEqual(['Running', 'running']);

  setMessages([
    reply([
      { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
      { id: 't2', label: 'Reading', detail: 'lib.rs', status: 'running' },
    ]),
  ]);
  expect(line(view)).toEqual(['Reading', 'running']);
  expect(view.queryAllByRole('listitem')).toEqual([]);

  // Between steps the line keeps the last one rather than going blank.
  setMessages([
    reply([
      { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
      { id: 't2', label: 'Read', detail: 'lib.rs', status: 'completed' },
    ]),
  ]);
  expect(line(view)).toEqual(['Read', 'completed']);
});

it('takes turns among tools called at once, and a new call takes the line at once', () => {
  vi.useFakeTimers();
  try {
    const view = render(() => (
      <AgentActivity
        agentSessionId="session"
        turn={2}
        segment={1}
        rows={snapshot}
        sealed={false}
      />
    ));
    const entities = {
      id: 't1',
      label: 'List entities',
      detail: null,
      status: 'running' as const,
    };
    const tags = { ...entities, id: 't2', label: 'List tags' };
    setMessages([reply([entities, tags])]);
    expect(line(view)[0]).toBe('List tags');
    vi.advanceTimersByTime(2000);
    expect(line(view)[0]).toBe('List entities');
    vi.advanceTimersByTime(2000);
    expect(line(view)[0]).toBe('List tags');
    vi.advanceTimersByTime(2000);
    expect(line(view)[0]).toBe('List entities');

    setMessages([
      reply([entities, tags, { ...entities, id: 't3', label: 'Search' }]),
    ]);
    expect(line(view)[0]).toBe('Search');
  } finally {
    vi.useRealTimers();
  }
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
  await waitFor(() => expect(line(view)).toEqual(['Read email', 'running']));
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
    expect(line(view)).toEqual(['Read email', 'interrupted'])
  );
  expect(view.queryByText(record.source)).toBeNull();

  code.read.mockRejectedValue(new Error('Temporary network failure'));
  await client.refetchQueries({ queryKey: ['agentCodeExecution'] });
  expect(line(view)).toEqual(['Read email', 'interrupted']);

  client.setQueriesData(
    { queryKey: ['agentCodeExecution'] },
    { ...record, source: 'another execution' }
  );
  await waitFor(() => expect(line(view)).toEqual(['Execute code', 'running']));
});

it('keeps the step in place as the run paints, rather than redrawing it', () => {
  const view = render(() => (
    <AgentActivity
      agentSessionId="session"
      turn={2}
      segment={1}
      rows={snapshot}
      sealed={false}
    />
  ));
  const shown = () =>
    view.getByRole('status').querySelector<HTMLElement>('[data-status]');
  setMessages([
    reply([{ id: 't1', label: 'Running', detail: 'cargo', status: 'running' }]),
  ]);
  const step = shown();

  // Every paint carries the run as new objects.
  setMessages([
    reply([{ id: 't1', label: 'Running', detail: 'cargo', status: 'running' }]),
  ]);
  expect(shown()).toBe(step);

  setMessages([
    reply([
      { id: 't1', label: 'Ran', detail: 'cargo', status: 'completed' },
      { id: 't2', label: 'Reading', detail: 'lib.rs', status: 'running' },
    ]),
  ]);
  expect(line(view)).toEqual(['Reading', 'running']);
});

it('names each step without what it ran or read, even to a reader of the live session', () => {
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
  snapshotView.getByRole('button', { name: 'Used 1 tool' }).click();
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
  expect(line(liveView)[0]).toBe('Ran');
  setMessages([
    reply([{ ...safe[0], detail: 'TOKEN=private-value run-report' }]),
  ]);
  expect(line(liveView)[0]).toBe('Ran');
  expect(liveView.queryByText(/private-value/)).toBeNull();
});
