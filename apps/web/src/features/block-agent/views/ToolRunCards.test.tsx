/**
 * @vitest-environment jsdom
 */

import type {
  ActivityCard,
  ActivityRow,
  FoldedMessage,
} from '@service-agent-fold/generated/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('@app/features/agent-cards/components/run-cards', () => ({
  default: (props: {
    cards: { key: string; kind: string; rowId: string }[];
  }) => {
    mounts.count += 1;
    return (
      <ul aria-label="Cards">
        <For each={props.cards}>
          {(card) => (
            <li>
              {card.kind}:{card.key}@{card.rowId}
            </li>
          )}
        </For>
      </ul>
    );
  },
}));

import { ToolRunCards } from './ToolRunCards';

afterEach(() => {
  cleanup();
  mounts.count = 0;
});

const created = (itemId: string): ActivityCard => ({
  kind: 'item',
  itemType: 'document',
  itemId,
  fileType: 'md',
  action: 'created',
  title: 'Launch plan',
  summary: null,
});

const row = (id: string, card?: ActivityCard): ActivityRow => ({
  id,
  label: 'Created document',
  detail: null,
  status: 'completed',
  card,
});

const reply = (rows: ActivityRow[][]): FoldedMessage => ({
  agentSessionId: 'session',
  turn: 2,
  author: { kind: 'agent' },
  requestId: null,
  parts: [],
  stop: { kind: 'end_turn' },
  pending: false,
  segments: rows.map((segment, index) => ({
    index,
    kind: 'activity',
    start: index,
    end: index + 1,
    sealed: true,
    rows: segment,
  })),
  phase: null,
  postedAt: null,
});

it('shows the cards of the calls in the run, in the order they ran', async () => {
  const view = render(() => (
    <ToolRunCards
      message={reply([
        [
          row('a', created('doc-1')),
          row('b'),
          row('c', {
            kind: 'data',
            sql: 'SELECT 1',
            databaseId: null,
            display: 'table',
          }),
        ],
        [row('elsewhere', created('doc-2'))],
      ])}
      calls={['a', 'b', 'c']}
    />
  ));
  const cards = await view.findAllByRole('listitem');
  expect(cards.map((card) => card.textContent)).toEqual([
    'item:document:doc-1@a',
    'data:c@c',
  ]);
});

it('leaves out a view: the session shows it where it ran', async () => {
  const view = render(() => (
    <ToolRunCards
      message={reply([
        [
          row('a', { kind: 'view', view: { widgets: [] } }),
          row('b', created('doc-1')),
        ],
      ])}
      calls={['a', 'b']}
    />
  ));
  const cards = await view.findAllByRole('listitem');
  expect(cards.map((card) => card.textContent)).toEqual([
    'item:document:doc-1@b',
  ]);
});

it('shows nothing for a run that produced nothing', async () => {
  const view = render(() => (
    <ToolRunCards message={reply([[row('a'), row('b')]])} calls={['a', 'b']} />
  ));
  await Promise.resolve();
  expect(view.queryByRole('list')).toBeNull();
  expect(mounts.count).toBe(0);
});

it('keeps the cards mounted while the run gets new snapshots', async () => {
  const [message, setMessage] = createSignal(
    reply([[row('a', created('doc-1')), { ...row('b'), status: 'running' }]])
  );
  const view = render(() => (
    <ToolRunCards message={message()} calls={['a', 'b']} />
  ));
  const list = await view.findByRole('list');
  setMessage(reply([[row('a', created('doc-1')), row('b', created('doc-2'))]]));
  const cards = await view.findAllByRole('listitem');
  expect(cards.map((card) => card.textContent)).toEqual([
    'item:document:doc-1@a',
    'item:document:doc-2@b',
  ]);
  expect(view.getByRole('list')).toBe(list);
  expect(mounts.count).toBe(1);
});
