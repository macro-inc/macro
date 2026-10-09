import type { AgentActivityRow } from '@macro-inc/lexical-core';
import type {
  ActivityRow,
  FoldedMessage,
} from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({ acquired: [] as (string | undefined)[] }));
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

import { AgentActivity } from './agent-activity';

afterEach(() => {
  cleanup();
  live.acquired.length = 0;
  setMessages([]);
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
